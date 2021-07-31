import { curve, ec as EC } from "elliptic";
import ripemd160 from "ripemd160";
import bs58 from "bs58";
import { sha256 } from "js-sha256";
import { Multihash, Transaction, VariableBlob, VariableBlobLike } from "koinos-types2";

const ec = new EC('secp256k1');

export function toUint8Array(hexString: string) {
    return new Uint8Array(
      hexString
        .match(/[\dA-F]{2}/gi) // separate into pairs
        .map((s) => parseInt(s, 16)) // convert to integers
    );
  }
  
  export function toHexString(buffer: Uint8Array) {
    return Array.from(buffer)
      .map((n) => `0${Number(n).toString(16)}`.slice(-2))
      .join("");
  }
  
  export class Wallet {
    key: EC.KeyPair;
  
    wif: string;
  
    address: string;
  
    constructor(privKeySeedOrWif: string | Uint8Array) {
      let compressed = true;
      if (typeof privKeySeedOrWif === "string") {
        if (privKeySeedOrWif.includes(" ")) {
          const seed = privKeySeedOrWif;
          this.key = ec.keyFromPrivate(sha256(seed));
        } else {
          const wif = privKeySeedOrWif;
          this.key = ec.keyFromPrivate(Wallet.bitcoinDecode(wif));
          compressed = wif[0] !== "5";
        }
      } else {
        this.key = ec.keyFromPrivate(privKeySeedOrWif);
      }
      this.address = Wallet.bitcoinAddress(toUint8Array(this.key.getPublic().encode("hex", compressed)));
      this.wif = Wallet.bitcoinEncode(toUint8Array(this.key.getPrivate().toString("hex")), "private", compressed);
    }
  
    static bitcoinEncode(
      buffer: Uint8Array,
      type: "public" | "private",
      compressed?: boolean
    ) {
      let bufferCheck: Uint8Array;
      let prefixBuffer: Uint8Array;
      let offsetChecksum: number;
      if (type === "public") {
        bufferCheck = new Uint8Array(25);
        prefixBuffer = new Uint8Array(21);
        bufferCheck[0] = 0;
        prefixBuffer[0] = 0;
        offsetChecksum = 21;
      } else {
        if (compressed) {
          bufferCheck = new Uint8Array(38);
          prefixBuffer = new Uint8Array(34);
          offsetChecksum = 34;
          bufferCheck[33] = 1;
          prefixBuffer[33] = 1;
        } else {
          bufferCheck = new Uint8Array(37);
          prefixBuffer = new Uint8Array(33);
          offsetChecksum = 33;
        }
        bufferCheck[0] = 128;
        prefixBuffer[0] = 128;
      }
      prefixBuffer.set(buffer, 1);
      const firstHash = sha256(prefixBuffer);
      const doubleHash = sha256(toUint8Array(firstHash));
      const checksum = toUint8Array(doubleHash.substring(0, 8));
      bufferCheck.set(buffer, 1);
      bufferCheck.set(checksum, offsetChecksum);
      return bs58.encode(bufferCheck);
    }
  
    static bitcoinDecode(value: string): Uint8Array {
      const buffer = bs58.decode(value);
      const privateKey = new Uint8Array(32);
      const checksum = new Uint8Array(4);
      const prefix = buffer[0];
      buffer.copy(privateKey, 0, 1, 33);
      if (value[0] !== "5") {
        // compressed
        buffer.copy(checksum, 0, 34, 38);
      } else {
        buffer.copy(checksum, 0, 33, 37);
      }
      // TODO: verify prefix and checksum
      return privateKey;
    }
  
    static bitcoinAddress(publicKey: Uint8Array): string {
      const hash = sha256(publicKey);
      const hash160 = new ripemd160()
        .update(Buffer.from(hash, "hex"))
        .digest("hex");
      return Wallet.bitcoinEncode(toUint8Array(hash160), "public");
    }
  
    sign(input: string | Transaction ): {
      id: Multihash;
      signature: VariableBlob
    } {
      let hash: string;
      if (typeof input === "string") {
        hash = input;
      } else {
        hash = sha256(input.activeData.serialize().buffer);
      }
      const signature = this.key.sign(hash, {
        canonical: true,
      });
      return {
        id: new Multihash({
          id: 0x12,
          digest: `f${hash}`,
        }),
        signature: compactSignature(signature),
      };
    }
  }

  export function compactSignature(sig: EC.Signature): VariableBlob {
    let rHex = sig.r.toString('hex');
    let sHex = sig.s.toString('hex');
    rHex = "0".repeat(64 - rHex.length) + rHex;
    sHex = "0".repeat(64 - sHex.length) + sHex;
    const compactSig = new VariableBlob(65);
    compactSig.writeUint8(sig.recoveryParam + 31);
    compactSig.write(toUint8Array(rHex));
    compactSig.write(toUint8Array(sHex));
    return compactSig;    
  }
  
  export function signer(
    signatureRec: VariableBlobLike,
    multihash: VariableBlobLike
  ): string {
    const sig = new VariableBlob(signatureRec);
    const hash = new Multihash(multihash);
    const recid = sig.buffer[0] >> 5;
    const r = sig.buffer.slice(1, 33);
    const s = sig.buffer.slice(33, 65);
    const signa = {
      r: toHexString(r),
      s: toHexString(s),
      recoveryParam: recid,
    }
    const pubPoint: curve.base.BasePoint = ec.recoverPubKey(hash.digest.buffer, signa, recid);
    const pub = toUint8Array( pubPoint.encode("hex", true) );
    return Wallet.bitcoinAddress(pub);
  }
  
  export default Wallet;

