import {
    VariableBlob,
    Multihash,
    BlockAcceptedJSON,
    Operation,
    VariableBlobLike,
    MultihashLike,
  } from "koinos-types2";

import * as crypto from "crypto";
import * as secp256k1 from "secp256k1";
import * as amqp from "amqplib/callback_api";
import UploadContractOperation from "koinos-types2/dist/protocol/UploadContractOperation";
import * as db from "./db";
import { Wallet } from "./wallet";

function signer(signatureRec: VariableBlobLike, multihash: VariableBlobLike): string {
  const sig = new VariableBlob(signatureRec);
  const hash = new Multihash(multihash);
  const recid = sig.buffer[0] >> 5;
  const signature = sig.buffer.slice(1);    
  const publicKey = secp256k1.ecdsaRecover(signature, recid, hash.digest.buffer, true);
  return Wallet.bitcoinAddress(publicKey);
}
  
  amqp.connect("amqp://guest:guest@localhost:5672/", (error0, connection) => {
    if (error0) throw error0;
  
    connection.createChannel((error1, channel) => {
      const exchange = "koinos.event"
      channel.assertExchange(exchange, "topic", {
        durable: true,
      });
      channel.assertQueue("", {
        exclusive: true,
      }, (error2, q) => {
          if (error2) throw error2;

          console.log(`Waiting for messages in ${exchange}. To exit press CTRL+C`);
          channel.bindQueue(q.queue, exchange, "koinos.block.accept");
          channel.consume(
            q.queue,
            (msg) => {
              const blockAccepted = JSON.parse(msg.content.toString()) as BlockAcceptedJSON;
              blockAccepted.block.transactions.forEach((tx) => {
                console.log(JSON.stringify(tx, null, 2))
                tx.active_data.operations.forEach((op) => {
                  if (op.type === Operation.KoinosProtocolUploadContractOperation) {
                    const operation = new UploadContractOperation(op.value);
                    const contractId = operation.contractId.toJSON();
                    console.log(`Contract ID ${contractId} was uploaded`);
                    /*put(contractId, {
                      block: {
                        id: blockAccepted.block.id,
                        height: blockAccepted.block.header.height,
                      },
                      transaction: {
                        id: tx.id,
                        signer: signer(tx.signature_data, tx.id),
                      },
                      bytecode: operation.bytecode.toJSON(),
                      extensions: operation.extensions.toJSON(),
                    })*/
                  }
                });
              });
            },
            {
              noAck: true,
            }
          );
      });
    });
  });