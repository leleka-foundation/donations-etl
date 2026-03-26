/**
 * Wise API response Zod schemas.
 *
 * Based on Wise API documentation:
 * https://docs.wise.com/api-docs/api-reference/balance-statement
 */
import { z } from 'zod'

/**
 * Amount with currency.
 */
export const WiseAmountSchema = z.object({
  value: z.number(),
  currency: z.string(),
})

export type WiseAmount = z.infer<typeof WiseAmountSchema>

/**
 * Merchant details for card transactions.
 */
export const WiseMerchantSchema = z.object({
  name: z.string().nullable().optional(),
  firstLine: z.string().nullable().optional(),
  postCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
})

/**
 * Transaction details.
 * Contains type-specific fields like senderName for deposits.
 */
export const WiseTransactionDetailsSchema = z.object({
  type: z.string(), // CARD, CONVERSION, DEPOSIT, TRANSFER, etc.
  description: z.string().optional(),
  senderName: z.string().optional(),
  senderAccount: z.string().optional(),
  paymentReference: z.string().optional(),
  category: z.string().optional(),
  merchant: WiseMerchantSchema.optional(),
  // For conversions
  sourceAmount: WiseAmountSchema.optional(),
  targetAmount: WiseAmountSchema.optional(),
  fee: WiseAmountSchema.optional(),
  rate: z.number().optional(),
  // For card transactions
  amount: WiseAmountSchema.optional(),
})

export type WiseTransactionDetails = z.infer<
  typeof WiseTransactionDetailsSchema
>

/**
 * Exchange details for foreign currency transactions.
 */
export const WiseExchangeDetailsSchema = z.object({
  forAmount: WiseAmountSchema.optional(),
  rate: z.number().nullable().optional(),
})

/**
 * Single transaction from Wise statement.
 */
export const WiseTransactionSchema = z.object({
  type: z.enum(['CREDIT', 'DEBIT']),
  date: z.string(), // ISO 8601 datetime
  amount: WiseAmountSchema,
  totalFees: WiseAmountSchema,
  details: WiseTransactionDetailsSchema,
  exchangeDetails: WiseExchangeDetailsSchema.nullable().optional(),
  runningBalance: WiseAmountSchema,
  referenceNumber: z.string(),
})

export type WiseTransaction = z.infer<typeof WiseTransactionSchema>

/**
 * Account holder address.
 */
export const WiseAddressSchema = z.object({
  addressFirstLine: z.string().optional(),
  city: z.string().optional(),
  postCode: z.string().optional(),
  stateCode: z.string().optional(),
  countryName: z.string().optional(),
})

/**
 * Account holder info.
 */
export const WiseAccountHolderSchema = z.object({
  type: z.string(), // PERSONAL or BUSINESS
  address: WiseAddressSchema.optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  name: z.string().optional(), // For business accounts
})

/**
 * Statement issuer info.
 */
export const WiseIssuerSchema = z.object({
  name: z.string(),
  firstLine: z.string().optional(),
  city: z.string().optional(),
  postCode: z.string().optional(),
  stateCode: z.string().optional(),
  country: z.string().optional(),
})

/**
 * Query parameters echoed back in response.
 * Note: v1/balance-statements may omit some fields like accountId.
 */
export const WiseQuerySchema = z.object({
  intervalStart: z.string(),
  intervalEnd: z.string(),
  currency: z.string().optional(),
  accountId: z.number().optional(),
})

/**
 * Response from balance statement endpoint.
 */
export const WiseStatementResponseSchema = z.object({
  accountHolder: WiseAccountHolderSchema,
  issuer: WiseIssuerSchema,
  bankDetails: z.unknown().nullable().optional(),
  transactions: z.array(WiseTransactionSchema),
  endOfStatementBalance: WiseAmountSchema,
  query: WiseQuerySchema,
})

export type WiseStatementResponse = z.infer<typeof WiseStatementResponseSchema>

/**
 * Single balance account.
 */
export const WiseBalanceSchema = z.object({
  id: z.number(),
  currency: z.string(),
  amount: WiseAmountSchema,
  reservedAmount: WiseAmountSchema.optional(),
})

export type WiseBalance = z.infer<typeof WiseBalanceSchema>

/**
 * Response from balances endpoint (array of balances).
 */
export const WiseBalancesResponseSchema = z.array(WiseBalanceSchema)

export type WiseBalancesResponse = z.infer<typeof WiseBalancesResponseSchema>

/**
 * Check if a transaction is a deposit (incoming donation).
 */
export function isDeposit(tx: WiseTransaction): boolean {
  return tx.type === 'CREDIT' && tx.details.type === 'DEPOSIT'
}
