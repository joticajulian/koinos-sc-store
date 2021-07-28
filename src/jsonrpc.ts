import axios from "axios";
import { BlockItemJSON, HeadInfoJSON } from "koinos-types2";

//const url = "http://localhost:8080";
const url = "http://45.56.104.152:8080";

export async function jsonrpc(method: string, params: unknown) {console.log({method, params})
  const response = await axios.post<{ result?: unknown; error?: unknown }>(
    url,
    {
      id: 1,
      jsonrpc: "2.0",
      method,
      params,
    }
  );

  if (response.data.error) {
    throw new Error(JSON.stringify(response.data.error));
  }

  return response.data.result;
}

export async function getHeadInfo() {
  return jsonrpc("chain.get_head_info", {}) as Promise<HeadInfoJSON>;
}

export async function getBlocks(height: number, numBlocks = 1, idRef?: string) {
  let blockIdRef = idRef;
  if (!blockIdRef) {
    const head = await getHeadInfo();
    blockIdRef = head.head_topology.id;
  }
  return jsonrpc("block_store.get_blocks_by_height", {
    head_block_id: blockIdRef,
    ancestor_start_height: height,
    num_blocks: numBlocks,
    return_block: true,
    return_receipt: false,
  }) as Promise<{
    block_items: BlockItemJSON[];
  }>;
}

async () => {
  const blocks = await getBlocks(123, 3);
  console.log(JSON.stringify(blocks, null, 2));
};
