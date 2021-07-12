FROM node:14.16.1-alpine3.13@sha256:4ffbef007b0214706fb8ec92353ccd5b0a12d9d1522e0f2c5e0a8bde3f9d8985 as base
WORKDIR /app
# Some dependencies need git to be installed (see yarn.lock)
RUN apk add --no-cache --virtual .build-deps git
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --silent --ignore-scripts && yarn cache clean

FROM base as builder
COPY tsconfig*.json ./
COPY src src
RUN yarn build

FROM base
WORKDIR /app
# Remove git
RUN apk del .build-deps
ENV NODE_ENV=production
COPY --from=builder /app/dist dist
RUN chown node:node /app
USER node
CMD [ "node", "dist/index" ]
