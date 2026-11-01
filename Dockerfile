# Le JavaScript produit ne dépend pas de la machine : il se compile en natif, même pour le NAS ARM.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

# npm est très lent en émulation ARM : les dépendances s'installent aussi en natif. Seuls les
# moteurs Prisma dépendent de la machine, on demande donc explicitement ceux du NAS.
# Le schéma seul est copié : une migration ne doit pas relancer cette étape.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-arm64-openssl-3.0.x,linux-musl-openssl-3.0.x
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --omit=dev

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY package.json ./
# Une image dont les moteurs ne tournent pas sur le NAS ne doit jamais être publiée.
RUN npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > /dev/null
RUN node -e "new (require('@prisma/client').PrismaClient)({ datasourceUrl: 'postgresql://x:x@127.0.0.1:1/x' }).\$connect().then(() => process.exit(1), (e) => process.exit(/reach database/.test(e.message) ? 0 : 1))"
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node build"]
