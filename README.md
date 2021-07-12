# Koinos Smart Contracts Store Microservice

Microservice to trace all smart contracts in the network.

## Run the microservice

Install the required packages dependencies and build the project:

```sh
yarn install
yarn build
```

Run the microservice

```sh
yarn start
```

It will connect with other microservices in order to get and process new blocks. It also connects with block store microservice if a synchronization is required.

## Run from docker

Include a new service in the docker compose of your node and define the path to the microservice, and volume to store data

```yaml
services:
  amqp:
    ...
  chain:   
    ...
  sc-store:
    build: ../koinos-sc-store
    depends_on:
         - amqp
         - block_store
    volumes:
      - "./database:/database"
```

Start docker

```sh
docker-compose up
```