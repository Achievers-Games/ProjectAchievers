# Le JavaScript produit ne dépend pas de la machine : il se compile en natif, même pour le NAS ARM.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

# Les moteurs Prisma, eux, doivent être ceux de la machine cible.
FROM node:22-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build ./build
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY package.json ./
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node build"]
