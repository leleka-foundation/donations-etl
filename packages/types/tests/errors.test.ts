import { describe, expect, it } from 'vitest'
import {
  createBigQueryError,
  createConfigError,
  createConnectorError,
  createGCSError,
  formatError,
  isBigQueryError,
  isConnectorError,
  isGCSError,
  type BigQueryError,
  type ConfigError,
  type ConnectorError,
  type GCSError,
} from '../src/errors'

describe('createConnectorError', () => {
  it('creates error with required fields', () => {
    const error = createConnectorError('api', 'mercury', 'Request failed')
    expect(error).toEqual({
      type: 'api',
      source: 'mercury',
      message: 'Request failed',
      statusCode: undefined,
      retryable: false,
    })
  })

  it('creates error with optional statusCode', () => {
    const error = createConnectorError('api', 'paypal', 'Not found', {
      statusCode: 404,
    })
    expect(error.statusCode).toBe(404)
  })

  it('uses default retryable for network errors', () => {
    const error = createConnectorError(
      'network',
      'givebutter',
      'Connection timeout',
    )
    expect(error.retryable).toBe(true)
  })

  it('uses default retryable for rate_limit errors', () => {
    const error = createConnectorError(
      'rate_limit',
      'mercury',
      'Too many requests',
    )
    expect(error.retryable).toBe(true)
  })

  it('uses default retryable for auth errors', () => {
    const error = createConnectorError('auth', 'paypal', 'Invalid token')
    expect(error.retryable).toBe(false)
  })

  it('uses default retryable for validation errors', () => {
    const error = createConnectorError(
      'validation',
      'givebutter',
      'Invalid response',
    )
    expect(error.retryable).toBe(false)
  })

  it('allows override of retryable', () => {
    const error = createConnectorError('api', 'mercury', 'Server error', {
      statusCode: 503,
      retryable: true,
    })
    expect(error.retryable).toBe(true)
  })
})

describe('createBigQueryError', () => {
  it('creates error with required fields', () => {
    const error = createBigQueryError('query', 'Query execution failed')
    expect(error).toEqual({
      type: 'query',
      message: 'Query execution failed',
      jobId: undefined,
      retryable: false,
    })
  })

  it('creates error with optional jobId', () => {
    const error = createBigQueryError('load', 'Load failed', {
      jobId: 'job_12345',
    })
    expect(error.jobId).toBe('job_12345')
  })

  it('quota errors are retryable by default', () => {
    const error = createBigQueryError('quota', 'Quota exceeded')
    expect(error.retryable).toBe(true)
  })

  it('query errors are not retryable by default', () => {
    const error = createBigQueryError('query', 'Syntax error')
    expect(error.retryable).toBe(false)
  })

  it('allows override of retryable', () => {
    const error = createBigQueryError('query', 'Transient error', {
      retryable: true,
    })
    expect(error.retryable).toBe(true)
  })
})

describe('createGCSError', () => {
  it('creates error with required fields', () => {
    const error = createGCSError('upload', 'Upload failed')
    expect(error).toEqual({
      type: 'upload',
      message: 'Upload failed',
      bucket: undefined,
      path: undefined,
      retryable: false,
    })
  })

  it('creates error with bucket and path', () => {
    const error = createGCSError('not_found', 'Object not found', {
      bucket: 'my-bucket',
      path: 'runs/123/data.ndjson',
    })
    expect(error.bucket).toBe('my-bucket')
    expect(error.path).toBe('runs/123/data.ndjson')
  })

  it('quota errors are retryable by default', () => {
    const error = createGCSError('quota', 'Quota exceeded')
    expect(error.retryable).toBe(true)
  })

  it('upload errors are not retryable by default', () => {
    const error = createGCSError('upload', 'Permission denied')
    expect(error.retryable).toBe(false)
  })
})

describe('createConfigError', () => {
  it('creates error with message', () => {
    const error = createConfigError('Missing required configuration')
    expect(error).toEqual({
      type: 'config',
      message: 'Missing required configuration',
      field: undefined,
    })
  })

  it('creates error with field', () => {
    const error = createConfigError('Invalid value', 'API_KEY')
    expect(error.field).toBe('API_KEY')
  })
})

describe('formatError', () => {
  describe('ConnectorError formatting', () => {
    it('formats api error', () => {
      const error: ConnectorError = {
        type: 'api',
        source: 'mercury',
        message: 'Server error',
        retryable: false,
      }
      expect(formatError(error)).toBe('[mercury] api: Server error')
    })

    it('formats auth error', () => {
      const error: ConnectorError = {
        type: 'auth',
        source: 'paypal',
        message: 'Invalid credentials',
        statusCode: 401,
        retryable: false,
      }
      expect(formatError(error)).toBe('[paypal] auth: Invalid credentials')
    })

    it('formats rate_limit error', () => {
      const error: ConnectorError = {
        type: 'rate_limit',
        source: 'givebutter',
        message: 'Too many requests',
        statusCode: 429,
        retryable: true,
      }
      expect(formatError(error)).toBe(
        '[givebutter] rate_limit: Too many requests',
      )
    })

    it('formats validation error', () => {
      const error: ConnectorError = {
        type: 'validation',
        source: 'mercury',
        message: 'Invalid JSON',
        retryable: false,
      }
      expect(formatError(error)).toBe('[mercury] validation: Invalid JSON')
    })

    it('formats network error', () => {
      const error: ConnectorError = {
        type: 'network',
        source: 'paypal',
        message: 'Connection timeout',
        retryable: true,
      }
      expect(formatError(error)).toBe('[paypal] network: Connection timeout')
    })
  })

  describe('BigQueryError formatting', () => {
    it('formats query error', () => {
      const error: BigQueryError = {
        type: 'query',
        message: 'Syntax error at position 42',
        retryable: false,
      }
      expect(formatError(error)).toBe(
        '[BigQuery] query: Syntax error at position 42',
      )
    })

    it('formats load error', () => {
      const error: BigQueryError = {
        type: 'load',
        message: 'Schema mismatch',
        jobId: 'job_123',
        retryable: false,
      }
      expect(formatError(error)).toBe('[BigQuery] load: Schema mismatch')
    })

    it('formats quota error', () => {
      const error: BigQueryError = {
        type: 'quota',
        message: 'Daily limit exceeded',
        retryable: true,
      }
      expect(formatError(error)).toBe('[BigQuery] quota: Daily limit exceeded')
    })
  })

  describe('GCSError formatting', () => {
    it('formats upload error', () => {
      const error: GCSError = {
        type: 'upload',
        message: 'Permission denied',
        bucket: 'my-bucket',
        path: 'data.json',
        retryable: false,
      }
      expect(formatError(error)).toBe('[GCS] upload: Permission denied')
    })

    it('formats not_found error', () => {
      const error: GCSError = {
        type: 'not_found',
        message: 'Object does not exist',
        bucket: 'my-bucket',
        retryable: false,
      }
      expect(formatError(error)).toBe('[GCS] not_found: Object does not exist')
    })
  })

  describe('ConfigError formatting', () => {
    it('formats config error without field', () => {
      const error: ConfigError = {
        type: 'config',
        message: 'Missing configuration',
      }
      expect(formatError(error)).toBe('[Config] Missing configuration')
    })

    it('formats config error with field', () => {
      const error: ConfigError = {
        type: 'config',
        message: 'Invalid value',
        field: 'API_KEY',
      }
      expect(formatError(error)).toBe('[Config] Invalid value (field: API_KEY)')
    })
  })
})

describe('isConnectorError', () => {
  it('returns true for ConnectorError', () => {
    const error: ConnectorError = {
      type: 'api',
      source: 'mercury',
      message: 'Request failed',
      retryable: false,
    }
    expect(isConnectorError(error)).toBe(true)
  })

  it('returns false for BigQueryError', () => {
    const error: BigQueryError = {
      type: 'query',
      message: 'Query failed',
      retryable: false,
    }
    expect(isConnectorError(error)).toBe(false)
  })

  it('returns false for GCSError', () => {
    const error: GCSError = {
      type: 'upload',
      message: 'Upload failed',
      retryable: false,
    }
    expect(isConnectorError(error)).toBe(false)
  })

  it('returns false for ConfigError', () => {
    const error: ConfigError = {
      type: 'config',
      message: 'Invalid config',
    }
    expect(isConnectorError(error)).toBe(false)
  })
})

describe('isBigQueryError', () => {
  it('returns true for query error', () => {
    const error: BigQueryError = {
      type: 'query',
      message: 'Query failed',
      retryable: false,
    }
    expect(isBigQueryError(error)).toBe(true)
  })

  it('returns true for load error', () => {
    const error: BigQueryError = {
      type: 'load',
      message: 'Load failed',
      retryable: false,
    }
    expect(isBigQueryError(error)).toBe(true)
  })

  it('returns true for schema error', () => {
    const error: BigQueryError = {
      type: 'schema',
      message: 'Schema mismatch',
      retryable: false,
    }
    expect(isBigQueryError(error)).toBe(true)
  })

  it('returns true for BigQuery quota error (no bucket field)', () => {
    const error: BigQueryError = {
      type: 'quota',
      message: 'Quota exceeded',
      retryable: true,
    }
    expect(isBigQueryError(error)).toBe(true)
  })

  it('returns true for BigQuery auth error (no source field)', () => {
    const error: BigQueryError = {
      type: 'auth',
      message: 'Auth failed',
      retryable: false,
    }
    expect(isBigQueryError(error)).toBe(true)
  })

  it('returns false for ConnectorError', () => {
    const error: ConnectorError = {
      type: 'api',
      source: 'mercury',
      message: 'Request failed',
      retryable: false,
    }
    expect(isBigQueryError(error)).toBe(false)
  })

  it('returns false for GCS quota error (has bucket field)', () => {
    const error: GCSError = {
      type: 'quota',
      message: 'Quota exceeded',
      bucket: 'my-bucket',
      retryable: true,
    }
    expect(isBigQueryError(error)).toBe(false)
  })

  it('returns false for Connector auth error (has source field)', () => {
    const error: ConnectorError = {
      type: 'auth',
      source: 'paypal',
      message: 'Auth failed',
      retryable: false,
    }
    expect(isBigQueryError(error)).toBe(false)
  })
})

describe('isGCSError', () => {
  it('returns true for upload error', () => {
    const error: GCSError = {
      type: 'upload',
      message: 'Upload failed',
      retryable: false,
    }
    expect(isGCSError(error)).toBe(true)
  })

  it('returns true for download error', () => {
    const error: GCSError = {
      type: 'download',
      message: 'Download failed',
      retryable: false,
    }
    expect(isGCSError(error)).toBe(true)
  })

  it('returns true for not_found error', () => {
    const error: GCSError = {
      type: 'not_found',
      message: 'Object not found',
      retryable: false,
    }
    expect(isGCSError(error)).toBe(true)
  })

  it('returns true for GCS quota error (has bucket field)', () => {
    const error: GCSError = {
      type: 'quota',
      message: 'Quota exceeded',
      bucket: 'my-bucket',
      retryable: true,
    }
    expect(isGCSError(error)).toBe(true)
  })

  it('returns true for GCS auth error (has bucket field)', () => {
    const error: GCSError = {
      type: 'auth',
      message: 'Auth failed',
      bucket: 'my-bucket',
      retryable: false,
    }
    expect(isGCSError(error)).toBe(true)
  })

  it('returns false for BigQuery error', () => {
    const error: BigQueryError = {
      type: 'query',
      message: 'Query failed',
      retryable: false,
    }
    expect(isGCSError(error)).toBe(false)
  })

  it('returns false for BigQuery quota error (no bucket)', () => {
    const error: BigQueryError = {
      type: 'quota',
      message: 'Quota exceeded',
      retryable: true,
    }
    expect(isGCSError(error)).toBe(false)
  })

  it('returns false for ConnectorError', () => {
    const error: ConnectorError = {
      type: 'api',
      source: 'mercury',
      message: 'Request failed',
      retryable: false,
    }
    expect(isGCSError(error)).toBe(false)
  })
})
