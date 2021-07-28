import ripemd160 from "ripemd160";
import bs58 from "bs58";
import { sha256 } from "js-sha256";
import crypto from "crypto";
import * as secp256k1 from "secp256k1";
import { Multihash, Transaction, VariableBlob, VariableBlobLike } from "koinos-types2";

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
  privateKey: Uint8Array;

  publicKey: Uint8Array;

  wif: string;

  address: string;

  constructor(privKeySeedOrWif: string | Uint8Array) {
    let compressed = true;
    if (typeof privKeySeedOrWif === "string") {
      if (privKeySeedOrWif.includes(" ")) {
        const seed = privKeySeedOrWif;
        this.privateKey = toUint8Array(sha256(seed));
      } else {
        const wif = privKeySeedOrWif;
        this.privateKey = Wallet.bitcoinDecode(wif);
        compressed = wif[0] !== "5";
      }
    } else {
      this.privateKey = privKeySeedOrWif;
    }
    this.publicKey = secp256k1.publicKeyCreate(this.privateKey, compressed);
    this.address = Wallet.bitcoinAddress(this.publicKey);
    this.wif = Wallet.bitcoinEncode(this.privateKey, "private", compressed);
    const a = secp256k1.privateKeyVerify(this.privateKey);
    console.log("verify private key");
    console.log(a)
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
    let rv: {signature: Uint8Array, recid: number};
    do {
      const options = {data: crypto.randomBytes(32)};
      rv = secp256k1.ecdsaSign(toUint8Array(hash), this.privateKey, options);
    } while (!isCanonicalSignature(rv.signature))
    const { signature, recid } = rv;
    const sig = new VariableBlob(65);
    sig.writeUint8(recid + 31);
    sig.write(signature);
    return {
      id: new Multihash({
        id: 0x12,
        digest: `f${hash}`,
      }),
      signature: sig,
    }
  }
}

function isCanonicalSignature(signature: Uint8Array): boolean {
  return (
      !(signature[0] & 0x80) &&
      !(signature[0] === 0 && !(signature[1] & 0x80)) &&
      !(signature[32] & 0x80) &&
      !(signature[32] === 0 && !(signature[33] & 0x80))
  )
}

export function signer(
  signatureRec: VariableBlobLike,
  multihash: VariableBlobLike
): string {console.log("signer usando secp256k1")
  const sig = new VariableBlob(signatureRec);
  const hash = new Multihash(multihash);
  const recid = sig.buffer[0] >> 5;
  const signature = sig.buffer.slice(1);
  const publicKey = secp256k1.ecdsaRecover(
    signature,
    recid,
    hash.digest.buffer,
    true
  );
  return Wallet.bitcoinAddress(publicKey);
}

export default Wallet;
