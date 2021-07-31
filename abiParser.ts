import { NumberLike, Str, Uint32, Uint64, VariableBlob, VariableBlobLike } from "koinos-types2";

export enum Type {
  uint32 = "uint32",
  uint64 = "uint64",
  variableBlob = "variableblob",
  accountType = "account_type",
};

export function serialize(data: unknown | Record<string, unknown>, abi: string | Record<string, unknown>): VariableBlob {
  const vb = new VariableBlob();
  if (typeof abi === "object") {
    Object.keys(abi).forEach(key => {
      const keyType = abi[key] as string | Record<string, unknown>;
      const value = data[key] as unknown | Record<string, unknown>;
      vb.write(serialize(value, keyType).buffer);
    });
    vb.resetCursor();
    return vb;
  }
  
  switch (abi) {
    case Type.variableBlob:
      vb.serialize(new VariableBlob(data as VariableBlobLike));
      break;
    case Type.accountType:
      vb.serialize(new Str(data as string));
      break;
    case Type.uint32:
      vb.serialize(new Uint32(data as NumberLike));
      break;
    case Type.uint64:
      vb.serialize(new Uint64(data as NumberLike));
      break;
    default: {
      throw new Error(`Unknown type ${abi}`);
    }
  }
  vb.resetCursor();
  return vb;
}

export function deserialize(vb: VariableBlob, abi: string | Record<string, unknown>): unknown {
    let data: unknown;
    if (typeof abi === "object") {
      data = {};
      Object.keys(abi).forEach(key => {
        const keyType = abi[key] as string | Record<string, unknown>;
        data[key] = deserialize(vb, keyType);
      });
      return data;
    }
    
    switch (abi) {
      case Type.variableBlob:
        return vb.deserializeVariableBlob().toJSON();
      case Type.accountType:
        return Str.deserialize(vb).str;
      case Type.uint32:
        return Uint32.deserialize(vb).num;
      case Type.uint64:
        return Uint64.deserialize(vb).num;
      default:
        throw new Error(`Unknown type ${abi}`);
    }
  }