/**
 * Tests for SQL safety validation.
 */
import { describe, expect, it } from 'vitest'
import { ensureLimit, validateReadOnlySql } from '../src/sql-safety'

describe('validateReadOnlySql', () => {
  it('accepts SELECT statements', () => {
    expect(validateReadOnlySql('SELECT * FROM donations.events')).toBeNull()
  })

  it('accepts WITH (CTE) statements', () => {
    expect(
      validateReadOnlySql(
        'WITH totals AS (SELECT SUM(amount_cents) FROM donations.events) SELECT * FROM totals',
      ),
    ).toBeNull()
  })

  it('is case-insensitive for SELECT', () => {
    expect(validateReadOnlySql('select * from donations.events')).toBeNull()
    expect(validateReadOnlySql('Select * From donations.events')).toBeNull()
  })

  it('rejects empty SQL', () => {
    expect(validateReadOnlySql('')).toBe('SQL query is empty')
    expect(validateReadOnlySql('   ')).toBe('SQL query is empty')
  })

  it('rejects DROP statements', () => {
    expect(validateReadOnlySql('DROP TABLE donations.events')).toContain(
      'must start with SELECT',
    )
  })

  it('rejects DELETE statements', () => {
    expect(
      validateReadOnlySql('DELETE FROM donations.events WHERE 1=1'),
    ).toContain('must start with SELECT')
  })

  it('rejects UPDATE statements', () => {
    expect(
      validateReadOnlySql('UPDATE donations.events SET status = "failed"'),
    ).toContain('must start with SELECT')
  })

  it('rejects INSERT statements', () => {
    expect(
      validateReadOnlySql(
        'INSERT INTO donations.events (source) VALUES ("test")',
      ),
    ).toContain('must start with SELECT')
  })

  it('rejects SELECT with embedded DROP', () => {
    expect(
      validateReadOnlySql('SELECT 1; DROP TABLE donations.events'),
    ).toContain('Forbidden SQL keyword: DROP')
  })

  it('rejects SELECT with embedded DELETE', () => {
    expect(
      validateReadOnlySql(
        'SELECT * FROM donations.events; DELETE FROM donations.events',
      ),
    ).toContain('Forbidden SQL keyword: DELETE')
  })

  it('rejects SELECT with embedded UPDATE', () => {
    expect(
      validateReadOnlySql(
        "SELECT * FROM donations.events; UPDATE donations.events SET status = 'x'",
      ),
    ).toContain('Forbidden SQL keyword: UPDATE')
  })

  it('rejects SELECT with embedded INSERT', () => {
    expect(
      validateReadOnlySql(
        'SELECT * FROM donations.events; INSERT INTO donations.events VALUES (1)',
      ),
    ).toContain('Forbidden SQL keyword: INSERT')
  })

  it('rejects ALTER', () => {
    expect(
      validateReadOnlySql('ALTER TABLE donations.events ADD COLUMN x STRING'),
    ).toContain('must start with SELECT')
  })

  it('rejects CREATE', () => {
    expect(validateReadOnlySql('CREATE TABLE x (id INT64)')).toContain(
      'must start with SELECT',
    )
  })

  it('rejects TRUNCATE', () => {
    expect(validateReadOnlySql('TRUNCATE TABLE donations.events')).toContain(
      'must start with SELECT',
    )
  })

  it('rejects MERGE', () => {
    expect(
      validateReadOnlySql(
        'MERGE INTO donations.events USING source ON true WHEN MATCHED THEN DELETE',
      ),
    ).toContain('must start with SELECT')
  })

  it('rejects GRANT', () => {
    expect(
      validateReadOnlySql(
        'SELECT 1; GRANT SELECT ON TABLE donations.events TO "user"',
      ),
    ).toContain('Forbidden SQL keyword: GRANT')
  })

  it('rejects REVOKE', () => {
    expect(
      validateReadOnlySql(
        'SELECT 1; REVOKE SELECT ON TABLE donations.events FROM "user"',
      ),
    ).toContain('Forbidden SQL keyword: REVOKE')
  })

  it('allows forbidden keywords inside string literals', () => {
    expect(
      validateReadOnlySql(
        "SELECT * FROM donations.events WHERE description = 'Please delete this'",
      ),
    ).toBeNull()
  })

  it('allows forbidden keywords inside double-quoted identifiers', () => {
    expect(
      validateReadOnlySql(
        'SELECT * FROM donations.events WHERE "drop_date" IS NOT NULL',
      ),
    ).toBeNull()
  })
})

describe('ensureLimit', () => {
  it('appends LIMIT 100 when no LIMIT present', () => {
    const result = ensureLimit('SELECT * FROM donations.events')
    expect(result).toContain('LIMIT 100')
  })

  it('preserves existing LIMIT clause', () => {
    const sql = 'SELECT * FROM donations.events LIMIT 50'
    const result = ensureLimit(sql)
    expect(result).toBe(sql)
    expect(result).not.toContain('LIMIT 100')
  })

  it('preserves LIMIT in any case', () => {
    const sql = 'SELECT * FROM donations.events limit 25'
    expect(ensureLimit(sql)).toBe(sql)
  })

  it('uses custom default limit', () => {
    const result = ensureLimit('SELECT * FROM donations.events', 50)
    expect(result).toContain('LIMIT 50')
  })

  it('strips trailing semicolons', () => {
    const result = ensureLimit('SELECT * FROM donations.events;')
    expect(result).not.toContain(';')
    expect(result).toContain('LIMIT 100')
  })

  it('does not confuse LIMIT in subqueries with outer LIMIT', () => {
    const sql = 'SELECT * FROM (SELECT * FROM donations.events LIMIT 10) sub'
    const result = ensureLimit(sql)
    // The subquery has LIMIT but the outer query does not, so LIMIT should be appended
    expect(result).toContain('LIMIT 100')
  })

  it('preserves outer LIMIT when subquery also has LIMIT', () => {
    const sql =
      'SELECT * FROM (SELECT * FROM donations.events LIMIT 10) sub LIMIT 50'
    expect(ensureLimit(sql)).toBe(sql)
  })
})
