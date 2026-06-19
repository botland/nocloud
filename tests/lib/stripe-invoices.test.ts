import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'
import {
  buildCheckoutInvoiceCreation,
  cleanupZeroTrialInvoice,
  handleSubscriptionTrialInvoice,
} from '@/lib/stripe-invoices'

describe('lib/stripe-invoices', () => {
  describe('buildCheckoutInvoiceCreation', () => {
    it('includes custom fields and reverse-charge footer', () => {
      const result = buildCheckoutInvoiceCreation({
        metadata: { order: '1' },
        company: 'Acme',
        vatNumber: 'FR123',
        poNumber: 'PO-9',
        vatTreatment: 'reverse_charge',
        description: 'Hardware order',
      })

      expect(result.enabled).toBe(true)
      expect(result.invoice_data?.custom_fields).toHaveLength(3)
      expect(result.invoice_data?.footer).toContain('Reverse charge')
    })

    it('omits empty custom fields', () => {
      const result = buildCheckoutInvoiceCreation({ metadata: {} })
      expect(result.invoice_data?.custom_fields).toBeUndefined()
    })
  })

  describe('cleanupZeroTrialInvoice', () => {
    let stripe: any

    beforeEach(() => {
      stripe = {
        invoices: {
          retrieve: vi.fn(),
          del: vi.fn(),
          finalizeInvoice: vi.fn(),
          voidInvoice: vi.fn(),
        },
      }
    })

    it('finalizes and voids draft zero invoices', async () => {
      stripe.invoices.retrieve.mockResolvedValue({
        status: 'draft',
        total: 0,
        amount_due: 0,
      })
      stripe.invoices.finalizeInvoice.mockResolvedValue({ status: 'open' })

      await cleanupZeroTrialInvoice(stripe as Stripe, 'inv_zero', 'test ctx')
      expect(stripe.invoices.del).not.toHaveBeenCalled()
      expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith('inv_zero')
      expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('inv_zero')
    })

    it('voids open zero invoices', async () => {
      stripe.invoices.retrieve.mockResolvedValue({
        status: 'open',
        total: 0,
        amount_due: 0,
      })

      await cleanupZeroTrialInvoice(stripe as Stripe, 'inv_open', 'test ctx')
      expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('inv_open')
    })

    it('skips void when draft finalizes as paid', async () => {
      stripe.invoices.retrieve.mockResolvedValue({
        status: 'draft',
        total: 0,
        amount_due: 0,
      })
      stripe.invoices.finalizeInvoice.mockResolvedValue({ status: 'paid' })

      await cleanupZeroTrialInvoice(stripe as Stripe, 'inv_sub_paid', 'test ctx')
      expect(stripe.invoices.del).not.toHaveBeenCalled()
      expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled()
    })

    it('skips non-zero invoices', async () => {
      stripe.invoices.retrieve.mockResolvedValue({
        status: 'draft',
        total: 100,
        amount_due: 100,
        amount_paid: 100,
      })

      await cleanupZeroTrialInvoice(stripe as Stripe, 'inv_paid', 'test ctx')
      expect(stripe.invoices.del).not.toHaveBeenCalled()
      expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled()
    })
  })

  describe('handleSubscriptionTrialInvoice', () => {
    let stripe: any

    beforeEach(() => {
      stripe = {
        invoices: {
          retrieve: vi.fn(),
          del: vi.fn(),
          finalizeInvoice: vi.fn(),
          voidInvoice: vi.fn(),
          update: vi.fn(),
        },
      }
    })

    it('delegates zero invoices to cleanup', async () => {
      stripe.invoices.retrieve.mockResolvedValue({
        status: 'draft',
        total: 0,
        amount_due: 0,
      })

      stripe.invoices.finalizeInvoice.mockResolvedValue({ status: 'open' })

      await handleSubscriptionTrialInvoice(stripe as Stripe, 'inv_zero', 'svc sub')
      expect(stripe.invoices.finalizeInvoice).toHaveBeenCalledWith('inv_zero')
      expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('inv_zero')
    })

    it('sets auto_advance on non-zero draft invoices', async () => {
      stripe.invoices.retrieve.mockResolvedValue({
        status: 'draft',
        total: 9900,
        amount_due: 9900,
      })

      await handleSubscriptionTrialInvoice(stripe as Stripe, 'inv_draft', 'svc sub', {
        description: 'First period',
        footer: 'VAT note',
      })

      expect(stripe.invoices.update).toHaveBeenCalledWith('inv_draft', {
        auto_advance: true,
        description: 'First period',
        footer: 'VAT note',
      })
    })
  })
})