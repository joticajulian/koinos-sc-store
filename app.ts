import {
    VariableBlob,
    Multihash,
    BlockAcceptedJSON,
    Operation,
    VariableBlobLike,
    BlockIrreversibleJSON,
    BlockTopologyJSON,
    BlockJSON,
  } from "koinos-types2";

import * as crypto from "crypto";
import axios from "axios";
import * as secp256k1 from "secp256k1";
import * as amqp from "amqplib";
import * as db from "./db";
import { Wallet } from "./wallet";
import log from "./logger";
import { getBlocks } from "./jsonrpc";
import { UploadContractOperationJSON } from "koinos-types2/dist/protocol/UploadContractOperation";

interface ContractDetails {
  contractId: string;
  data: {
    bytecode: string;
    extensions: unknown;
    block: {
      id: string;
      height: number;
    },
    transaction: {
      id: string;
      signer: string;
    },
  };
};

class KoinosSCMicroservice {
  contractsAccepted: ContractDetails[] = [];

  irreversibleBlocksProcessed: BlockTopologyJSON[];

  oldestAcceptedBlock: number;

  syncying: boolean;

  constructor() {
    this.contractsAccepted = [];
    this.irreversibleBlocksProcessed = [];
    this.syncying = false;
  }

  processPendingBlock(block: BlockJSON) {
    block.transactions.forEach((tx) => {
      tx.active_data.operations.forEach((operation) => {
        if (operation.type === Operation.KoinosProtocolUploadContractOperation) {
          const op = operation.value as UploadContractOperationJSON;
          console.log(`Contract ID ${op.contract_id} was uploaded`);
          
          // return if it already exist in the pending list
          if (this.contractsAccepted.find(c => (
            c.data.block.id === block.id &&
            c.data.transaction.id === tx.id
          ))) {
            return;
          }

          // add contract to the pending list
          this.contractsAccepted.push({
            contractId: op.contract_id,
            data: {
              bytecode: op.bytecode,
              extensions: op.extensions,
              block: {
                id: block.id,
                height: block.header.height as number,
              },
              transaction: {
                id: tx.id,
                signer: signer(tx.signature_data, tx.id),
              },
            },
          });
        }
      });
    });
  }

  // function to move pending contracts to the database
  // and delete contracts from orphan transactions 
  async setBlockIrreversible(blockIrreversible: BlockIrreversibleJSON) {
    
    // filtering orphan blocks
    this.contractsAccepted = this.contractsAccepted.filter((c) => {
      return c.data.block.height !== blockIrreversible.topology.height ||
        c.data.block.id === blockIrreversible.topology.id;
    });

    if (this.contractsAccepted.length > 0) {
      log(`There are ${this.contractsAccepted.length} contracts accepted in the queue from blocks: ${
        this.contractsAccepted.map(c => c.data.block.height)
      }`);
    }

    // check status of actual database
    if(blockIrreversible.topology.height > db.getBlockHeight() + 1) {
      // save the block as processed
      this.irreversibleBlocksProcessed.push(blockIrreversible.topology);
      
      log(`Calling blockstore because db.blockHeight is ${db.getBlockHeight()} and amqp is in block ${blockIrreversible.topology.height}`);
      this.syncronize();
      return;
    }

    if(blockIrreversible.topology.height < db.getBlockHeight() + 1) {
      log(`Warning: irreversible block ${blockIrreversible.topology.height} already in the database (height: ${db.getBlockHeight()}). Ignoring block`);
      return;
    }

    // update database with the irreversible block
    await this.updateDatabase(blockIrreversible.topology);
  };

  // call the block store to synchronize
  async syncronize() {
    if (this.syncying) return;
    this.syncying = true;

    let blockNumber = db.getBlockHeight() + 1;
    let diffBlocks = this.irreversibleBlocksProcessed[0].height as number - blockNumber;
    while (diffBlocks > 0) {
      log(`Synchronization: Getting blocks from ${blockNumber}`);
      const numBlocks = Math.min(200, diffBlocks);
      const blocks = await getBlocks(blockNumber, numBlocks);
      for(let i=0; i<blocks.block_items.length; i+=1) {
        const blockItem = blocks.block_items[i];
        this.processPendingBlock(blockItem.block);
        const topology: BlockTopologyJSON = {
          id: blockItem.block.id,
          height: blockItem.block_height
        };
        await this.updateDatabase(topology);
      }
      blockNumber = db.getBlockHeight() + 1;
      diffBlocks = this.irreversibleBlocksProcessed[0].height as number - blockNumber;
    }

    if (diffBlocks < 0) {
      log(`fatal: ${JSON.stringify({
        blockNumber,
        processed0: this.irreversibleBlocksProcessed[0],
        diffBlocks,
      })}`);
      this.irreversibleBlocksProcessed.sort((a,b) => (a.height as number) - (b.height as number));
      this.irreversibleBlocksProcessed = this.irreversibleBlocksProcessed.filter(b => {
        return b.height >= blockNumber;
      });
    }

    while(this.irreversibleBlocksProcessed.length > 0 &&
      this.irreversibleBlocksProcessed[0].height === db.getBlockHeight() + 1
    ) {
      const [topology] = this.irreversibleBlocksProcessed.splice(0,1);
      await this.updateDatabase(topology);
    }
    this.syncying = false;
  };

  async updateDatabase(topology: BlockTopologyJSON) {
    // append new items to database taking them from the pending list
    let index = this.contractsAccepted.findIndex(c => {
      return c.data.block.id === topology.id
    });
    while(index >= 0) {
      const [contract] = this.contractsAccepted.splice(index, 1);
      await db.appendContract(contract.contractId, contract.data);
      log(`Contract ${contract.contractId} appended to the database`);
      
      if (contract.data.block.height >= this.oldestAcceptedBlock) {
        this.oldestAcceptedBlock = this.contractsAccepted.reduce((min, c) => {
          return c.data.block.height < min ? c.data.block.height : min;
        }, Number.MAX_SAFE_INTEGER);
      }
      index = this.contractsAccepted.findIndex(c => {
        return c.data.block.id === topology.id
      });
    }

    // check if the pending list contains only fresh items
    if (this.contractsAccepted.find(c => (
      c.data.block.height <= topology.height
    ))) {
      // there are pending items from old blocks, even older than the irreversible
      // block stored in the database
      const oldContracts = this.contractsAccepted.filter(c => (
        c.data.block.height <= topology.height
      ));
      log(`fatal: ${oldContracts.length} contracts are still in the pending list. They will be removed`);
      this.contractsAccepted = this.contractsAccepted.filter(c => (
        c.data.block.height > topology.height
      ));
    }

    // update block height in the database
    await db.putBlockHeight(topology.height as number);
  }
}

function signer(signatureRec: VariableBlobLike, multihash: VariableBlobLike): string {
  const sig = new VariableBlob(signatureRec);
  const hash = new Multihash(multihash);
  const recid = sig.buffer[0] >> 5;
  const signature = sig.buffer.slice(1);    
  const publicKey = secp256k1.ecdsaRecover(signature, recid, hash.digest.buffer, true);
  return Wallet.bitcoinAddress(publicKey);
}

const microservice = new KoinosSCMicroservice();

(async() => {
  await db.open();
  const connection = await amqp.connect("amqp://guest:guest@localhost:5672/");
  const channel = await connection.createChannel();
  const exchange = "koinos.event";
  channel.assertExchange(exchange, "topic", { durable: true });
  const q1 = await channel.assertQueue("", { exclusive: true });
  log(`Waiting for messages in ${exchange}`);
  channel.bindQueue(q1.queue, exchange, "koinos.block.accept");
  channel.consume(q1.queue, (msg) => {
    const blockAccepted = JSON.parse(msg.content.toString()) as BlockAcceptedJSON;
    log(`Block accepted: ${blockAccepted.block.header.height}`);
    microservice.processPendingBlock(blockAccepted.block);
  },
  {
    noAck: true,
  });
  
  const q2 = await channel.assertQueue("", { exclusive: true });
  channel.bindQueue(q2.queue, exchange, "koinos.block.irreversible");
  channel.consume(q2.queue, (msg) => {
    const blockIrreversible = JSON.parse(msg.content.toString()) as BlockIrreversibleJSON;
    log(`Block irreversible: ${blockIrreversible.topology.height}`);
    microservice.setBlockIrreversible(blockIrreversible);
  },
  {
    noAck: true,
  });
})()
