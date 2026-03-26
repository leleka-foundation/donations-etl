/**
 * PayPal Transaction Search API response Zod schemas.
 *
 * Based on PayPal API documentation:
 * https://developer.paypal.com/docs/api/transaction-search/v1/
 */
import { z } from 'zod'

/**
 * PayPal money amount.
 */
export const PayPalMoneySchema = z.object({
  currency_code: z.string().length(3),
  value: z.string(), // PayPal returns amounts as strings
})

export type PayPalMoney = z.infer<typeof PayPalMoneySchema>

/**
 * PayPal money amount with optional fields.
 * Used in nested structures like tax_amounts where fields can be missing.
 */
export const PayPalOptionalMoneySchema = z.object({
  currency_code: z.string().optional(),
  value: z.string().optional(),
})

/**
 * Payer name structure.
 */
export const PayPalPayerNameSchema = z.object({
  prefix: z.string().optional(),
  given_name: z.string().optional(),
  surname: z.string().optional(),
  middle_name: z.string().optional(),
  suffix: z.string().optional(),
  alternate_full_name: z.string().optional(),
})

/**
 * Address structure.
 */
export const PayPalAddressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country_code: z.string().length(2).optional(),
  postal_code: z.string().optional(),
})

/**
 * Payer information.
 */
export const PayPalPayerInfoSchema = z.object({
  account_id: z.string().optional(),
  email_address: z.string().optional(),
  phone_number: z
    .object({
      country_code: z.string().optional(),
      national_number: z.string().optional(),
    })
    .optional(),
  payer_name: PayPalPayerNameSchema.optional(),
  address: PayPalAddressSchema.optional(),
  payer_status: z.enum(['Y', 'N']).optional(),
})

export type PayPalPayerInfo = z.infer<typeof PayPalPayerInfoSchema>

/**
 * Shipping information.
 */
export const PayPalShippingInfoSchema = z.object({
  name: z.string().optional(),
  method: z.string().optional(),
  address: PayPalAddressSchema.optional(),
})

/**
 * Item details in cart.
 */
export const PayPalItemDetailSchema = z.object({
  item_code: z.string().optional(),
  item_name: z.string().optional(),
  item_description: z.string().optional(),
  item_quantity: z.string().optional(),
  item_unit_price: PayPalMoneySchema.optional(),
  item_amount: PayPalMoneySchema.optional(),
  // tax_amounts entries can have missing fields in PayPal API responses
  tax_amounts: z.array(PayPalOptionalMoneySchema).optional(),
})

/**
 * Cart information.
 */
export const PayPalCartInfoSchema = z.object({
  item_details: z.array(PayPalItemDetailSchema).optional(),
  tax_inclusive: z.boolean().optional(),
  paypal_invoice_id: z.string().optional(),
})

export type PayPalCartInfo = z.infer<typeof PayPalCartInfoSchema>

/**
 * Transaction status codes.
 * D = Denied, P = Pending, S = Success, V = Reversed
 */
export const PayPalTransactionStatusSchema = z.enum(['D', 'P', 'S', 'V'])

export type PayPalTransactionStatus = z.infer<
  typeof PayPalTransactionStatusSchema
>

/**
 * Transaction information.
 */
export const PayPalTransactionInfoSchema = z.object({
  paypal_account_id: z.string().optional(),
  transaction_id: z.string(),
  paypal_reference_id: z.string().optional(),
  paypal_reference_id_type: z.string().optional(),
  transaction_event_code: z.string().optional(),
  transaction_initiation_date: z.string().optional(),
  transaction_updated_date: z.string().optional(),
  transaction_amount: PayPalMoneySchema.optional(),
  fee_amount: PayPalMoneySchema.optional(),
  discount_amount: PayPalMoneySchema.optional(),
  insurance_amount: PayPalMoneySchema.optional(),
  shipping_amount: PayPalMoneySchema.optional(),
  shipping_discount_amount: PayPalMoneySchema.optional(),
  transaction_status: PayPalTransactionStatusSchema.optional(),
  transaction_subject: z.string().optional(),
  transaction_note: z.string().optional(),
  invoice_id: z.string().optional(),
  custom_field: z.string().optional(),
  protection_eligibility: z.string().optional(),
})

export type PayPalTransactionInfo = z.infer<typeof PayPalTransactionInfoSchema>

/**
 * Single transaction detail from search results.
 */
export const PayPalTransactionDetailSchema = z.object({
  transaction_info: PayPalTransactionInfoSchema,
  payer_info: PayPalPayerInfoSchema.optional(),
  shipping_info: PayPalShippingInfoSchema.optional(),
  cart_info: PayPalCartInfoSchema.optional(),
})

export type PayPalTransactionDetail = z.infer<
  typeof PayPalTransactionDetailSchema
>

/**
 * Response from transaction search endpoint.
 */
export const PayPalTransactionSearchResponseSchema = z.object({
  transaction_details: z.array(PayPalTransactionDetailSchema),
  account_number: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  last_refreshed_datetime: z.string().optional(),
  page: z.number().optional(),
  total_items: z.number().optional(),
  total_pages: z.number().optional(),
  links: z
    .array(
      z.object({
        href: z.string(),
        rel: z.string(),
        method: z.string().optional(),
      }),
    )
    .optional(),
})

export type PayPalTransactionSearchResponse = z.infer<
  typeof PayPalTransactionSearchResponseSchema
>

/**
 * OAuth token response.
 */
export const PayPalTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  app_id: z.string().optional(),
  expires_in: z.number(),
  scope: z.string().optional(),
  nonce: z.string().optional(),
})

export type PayPalTokenResponse = z.infer<typeof PayPalTokenResponseSchema>
