import leveldown from "leveldown";
import log from "./logger";

//@ts-ignore TS2349
const ld = leveldown("./database");

const KEY_BLOCK_HEIGHT = "H";
const KEY_TOTAL_CONTRACTS = "T";
const PREFIX_CONTRACT_NUMBER = "N";
const PREFIX_CONTRACT_ID = "C";

let totalContracts = 0;
let blockHeight = 0;

export async function open() {
  await new Promise((resolve, reject) => {
    ld.open(null, (error: Error) => {
      if (error) reject(error);
      resolve(true);
    });
  });

  try {
    totalContracts = await getNumber(KEY_TOTAL_CONTRACTS);
  } catch (error) {
    log("Initializing total contracts = 0");
    await putNumber(KEY_TOTAL_CONTRACTS, 0);
    totalContracts = 0;
  }

  try {
    blockHeight = await getNumber(KEY_BLOCK_HEIGHT);
  } catch (error) {
    log("Initializing block height = 0");
    await putNumber(KEY_BLOCK_HEIGHT, 0);
    blockHeight = 0;
  }
}

export async function put(key: string, buffer: Buffer) {
  return new Promise((resolve, reject) => {
    ld.put(key, buffer, (error: Error) => {
      if (error) reject(error);
      resolve(true);
    });
  });
}

export async function get(key: string) {
  return new Promise((resolve: (obj: Buffer) => void, reject) => {
    ld.get(key, (error: Error, buffer: Buffer) => {
      if (error) reject(error);
      resolve(buffer);
    });
  });
}

export async function del(key: string) {
  return new Promise((resolve, reject) => {
    ld.del(key, (error: Error) => {
      if (error) reject(error);
      resolve(true);
    });
  });
}

export async function putObject(key: string, value: unknown) {
  const uint8array = new TextEncoder().encode(JSON.stringify(value));
  const buffer = Buffer.from(uint8array);
  return put(key, buffer);
}

export async function getObject(key: string): Promise<unknown> {
  const buffer = await get(key);
  const str = new TextDecoder().decode(buffer);
  return JSON.parse(str);
}

export async function putString(key: string, str: string) {
  const buffer = Buffer.from(str, "utf8");
  return put(key, buffer);
}

export async function getString(key: string) {
  const buffer = await get(key);
  return buffer.toString("utf8");
}

export async function putNumber(key: string, n: number) {
  return putString(key, Number(n).toString());
}

export async function getNumber(key: string) {
  const str = await getString(key);
  return Number(str);
}

export async function putBlockHeight(n: number) {
  await putNumber(KEY_BLOCK_HEIGHT, n);
  blockHeight = n;
}

export function getBlockHeight() {
  return blockHeight;
}

export async function getTotalContracts() {
  return totalContracts;
}

export async function appendContract(id: string, data: unknown) {
  await putObject(`${PREFIX_CONTRACT_ID}${id}`, data);
  const contractNumber = totalContracts;
  await putString(`${PREFIX_CONTRACT_NUMBER}${contractNumber}`, id);
  totalContracts += 1;
  await putNumber(KEY_TOTAL_CONTRACTS, totalContracts);
}

export async function updateContract(id: string, data: unknown) {
  return putObject(`${PREFIX_CONTRACT_ID}${id}`, data);
}

export async function getContractById(id: string) {
  return await getObject(`${PREFIX_CONTRACT_ID}${id}`);
}

export async function getContractByNumber(contractNumber: number) {
  if (contractNumber >= totalContracts)
    throw new Error(
      `Contract number ${contractNumber} not Found. Total contracts: ${totalContracts}`
    );
  const id = await getString(`${PREFIX_CONTRACT_NUMBER}${contractNumber}`);
  return getContractById(id);
}

/*
(async () => {
  await open();
  const a = await getContractByNumber(2);
  console.log(a);
})()*/
