/**
 * Mercury API response Zod schemas.
 *
 * Based on Mercury API documentation:
 * https://docs.mercury.com/reference/transactions-1
 */
import { z } from 'zod'

/**
 * Address structure in transaction details.
 */
export const MercuryAddressSchema = z.object({
  address1: z.string().nullable().optional(),
  address2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
})

/**
 * Routing info for domestic wires.
 */
export const MercuryDomesticWireRoutingSchema = z.object({
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
  address: MercuryAddressSchema.optional(),
})

/**
 * Routing info for electronic transfers (ACH).
 */
export const MercuryElectronicRoutingSchema = z.object({
  accountNumber: z.string().optional(),
  routingNumber: z.string().optional(),
  bankName: z.string().optional(),
})

/**
 * International wire routing info.
 */
export const MercuryInternationalWireRoutingSchema = z.object({
  iban: z.string().optional(),
  swiftCode: z.string().optional(),
  correspondentInfo: z.unknown().optional(),
  bankDetails: z.unknown().optional(),
})

/**
 * Transaction details object.
 */
export const MercuryTransactionDetailsSchema = z.object({
  address: MercuryAddressSchema.optional(),
  domesticWireRoutingInfo: MercuryDomesticWireRoutingSchema.optional(),
  electronicRoutingInfo: MercuryElectronicRoutingSchema.optional(),
  internationalWireRoutingInfo:
    MercuryInternationalWireRoutingSchema.optional(),
})

/**
 * Single transaction from Mercury API.
 */
export const MercuryTransactionSchema = z.object({
  id: z.string(),
  amount: z.number(), // Negative for debits, positive for credits
  bankDescription: z.string().nullable(),
  counterpartyId: z.string(),
  counterpartyName: z.string(),
  counterpartyNickname: z.string().nullable().optional(),
  createdAt: z.string(), // ISO 8601 datetime
  dashboardLink: z.string().optional(),
  details: MercuryTransactionDetailsSchema.nullable().optional(),
  externalMemo: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  kind: z.string(), // externalTransfer, internalTransfer, outgoingPayment, etc.
  note: z.string().nullable().optional(),
  postedAt: z.string().nullable().optional(),
  reasonForFailure: z.string().nullable().optional(),
  // Mercury API returns various status values. Common ones are pending, sent,
  // cancelled, failed, but API may return additional values like "completed".
  // Using string to be permissive rather than break on unknown statuses.
  status: z.string(),
  trackingNumber: z.string().nullable().optional(),
})

export type MercuryTransaction = z.infer<typeof MercuryTransactionSchema>

/**
 * Response from /transactions or /account/:id/transactions endpoint.
 */
export const MercuryTransactionsResponseSchema = z.object({
  total: z.number(),
  transactions: z.array(MercuryTransactionSchema),
})

export type MercuryTransactionsResponse = z.infer<
  typeof MercuryTransactionsResponseSchema
>

/**
 * Account info (for account listing).
 */
export const MercuryAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  type: z.string(),
  legalBusinessName: z.string().optional(),
  currentBalance: z.number().optional(),
  availableBalance: z.number().optional(),
})

export type MercuryAccount = z.infer<typeof MercuryAccountSchema>

/**
 * Response from /accounts endpoint.
 */
export const MercuryAccountsResponseSchema = z.object({
  accounts: z.array(MercuryAccountSchema),
})

export type MercuryAccountsResponse = z.infer<
  typeof MercuryAccountsResponseSchema
>
