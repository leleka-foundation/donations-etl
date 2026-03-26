/**
 * PayPal connector public API.
 */
export {
  PAYPAL_BASE_URL,
  PAYPAL_DEFAULT_PAGE_SIZE,
  PAYPAL_SANDBOX_URL,
  PayPalClient,
} from './client'
export {
  PayPalConnector,
  type IPayPalClient,
  type PayPalConnectorOptions,
} from './connector'
export {
  PayPalMoneySchema,
  PayPalPayerInfoSchema,
  PayPalTokenResponseSchema,
  PayPalTransactionDetailSchema,
  PayPalTransactionInfoSchema,
  PayPalTransactionSearchResponseSchema,
  type PayPalMoney,
  type PayPalPayerInfo,
  type PayPalTokenResponse,
  type PayPalTransactionDetail,
  type PayPalTransactionInfo,
  type PayPalTransactionSearchResponse,
  type PayPalTransactionStatus,
} from './schema'
export {
  buildDonorName,
  buildDonorPhone,
  extractDonorAddress,
  isIncomingPayment,
  mapPayPalPaymentMethod,
  mapPayPalStatus,
  parsePayPalMoney,
  transformPayPalTransaction,
  transformPayPalTransactions,
} from './transformer'
