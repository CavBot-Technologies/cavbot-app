import { empty, join, raw, sqltag, type Sql } from "@prisma/client/runtime/client";
import type { Prisma } from "@prisma/client";

export type { Sql };

export const prismaEmpty = empty;
export const prismaJoin = join;
export const prismaRaw = raw;
export const prismaSql = sqltag;

export const SERIALIZABLE_TX_ISOLATION_LEVEL: Prisma.TransactionIsolationLevel = "Serializable";
