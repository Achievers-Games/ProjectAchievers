# Le JavaScript produit ne dépend pas de la machine : il se compile en natif, même pour le NAS ARM.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
# Seulement ce que l'installation lit : une nouvelle migration ne doit pas la refaire (~480 Mo
# de dépendances, recopiés à chaque fois dans le cache de la CI).
COPY package*.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/generated/tsconfig.json ./prisma/generated/tsconfig.json
RUN npm ci
COPY . .
RUN npm run build

# Depuis Prisma 7, le client passe par le pilote `pg` : plus aucun moteur binaire propre à
# une architecture à installer. Cette étape ne garde que les dépendances de production.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package*.json prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/schema.prisma
# Le tsconfig qui protège la génération de la lecture du tsconfig de SvelteKit.
COPY prisma/generated/tsconfig.json ./prisma/generated/tsconfig.json
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Le commit publié, lu par `/api/health` : on sait quelle version tourne sur le NAS.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY --from=build /app/build ./build
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
COPY prisma.config.ts package.json ./
# Une image dont la migration ne peut pas être calculée ne doit jamais être publiée.
RUN npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > /dev/null
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node build"]
