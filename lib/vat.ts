/**
 * lib/vat.ts
 *
 * Centralized, pure, auditable VAT treatment logic for B2B EU sales (supplier = FR).
 * Used by BOTH client (CheckoutModal: conditional "VAT-inclusive" checkbox, live previews)
 * and server (/api/checkout: authoritative validation + grossing + metadata).
 *
 * Core principles (per functional spec):
 * - Legal requirements ALWAYS take precedence over customer preference.
 * - VAT Treatment Determination happens EARLY, before any choice is considered or offered.
 * - Never offer (or accept) "VAT-inclusive" when reverse charge is mandatory.
 * - Full traceability: every determination returns a `reason` + flags captured in Stripe metadata.
 * - All prices in lib/pricing.ts and resolvePricesAndServices remain the net/ex-VAT taxable base.
 *   VAT grossing is an overlay applied only at the point of creating Stripe charges (line items, invoiceItems, price_data).
 * - Conservative for unknowns / 'other' countries / ambiguous cases: no offer, net (or mandatory) treatment.
 *
 * Before enabling in production for any country: this file + sample outputs + generated invoices
 * must be reviewed and approved by a qualified tax advisor (per spec §11).
 *
 * Supported today: FR (supplier), DE/NL/BE/ES/IT (intra-EU), 'other'.
 * Supply type currently treated uniformly for the order (appliances = goods primary; services follow).
 */

import { DEBUG_PAYMENTS } from './pricing'; // reuse the debug pattern

export const DEBUG_VAT =
  (process.env.DEBUG_VAT === 'true' || process.env.DEBUG_VAT === '1') ||
  DEBUG_PAYMENTS; // allow DEBUG_PAYMENTS to also surface VAT logs

export const SUPPLIER_COUNTRY = 'FR' as const;

/** EU countries for which we have explicit rules (customer perspective). */
export const EU_COUNTRIES = ['FR', 'DE', 'NL', 'BE', 'ES', 'IT'] as const;
export type EuCountry = (typeof EU_COUNTRIES)[number] | 'other';

/** Standard VAT rates (as of 2026; percentages as decimals). Comment for tax advisor review. */
export const VAT_RATES: Record<string, number> = {
  FR: 0.20, // France (supplier)
  DE: 0.19, // Germany
  NL: 0.21, // Netherlands
  BE: 0.21, // Belgium
  ES: 0.21, // Spain
  IT: 0.22, // Italy
  // 'other' and unknown => 0 (export / zero-rated conservative default)
};

/** Simple helper (pure). */
export function isEuCountry(country: string | undefined): boolean {
  if (!country) return false;
  const c = country.toUpperCase();
  return (EU_COUNTRIES as readonly string[]).includes(c) && c !== 'other';
}

/** Returns the VAT rate for a customer country (falls back to 0). */
export function getVatRate(country: string | undefined): number {
  if (!country) return 0;
  return VAT_RATES[country.toUpperCase()] ?? 0;
}

/**
 * Basic VAT number format validation (no external VIES call — pure + offline).
 * Requires:
 * - Non-empty after trim
 * - For known EU countries: prefix roughly matches the country (e.g. starts with "FR" for FR customer)
 * - Minimum plausible length
 *
 * "Valid" here means "sufficiently well-formed to consider for reverse-charge eligibility".
 * Full VIES / real-time validation can be added later (server-side proxy) without changing this API.
 */
export function validateVatNumber(
  vatNumber: string | undefined,
  customerCountry: string | undefined,
): { isValid: boolean; reason?: string } {
  if (!vatNumber || !vatNumber.trim()) {
    return { isValid: false, reason: 'No VAT number provided' };
  }
  const vat = vatNumber.trim().toUpperCase().replace(/[\s.-]/g, ''); // normalize common separators
  if (vat.length < 5) {
    return { isValid: false, reason: 'VAT number too short' };
  }
  if (customerCountry && isEuCountry(customerCountry)) {
    const expectedPrefix = customerCountry.toUpperCase();
    if (!vat.startsWith(expectedPrefix)) {
      return {
        isValid: false,
        reason: `VAT number prefix does not match customer country ${customerCountry} (expected to start with ${expectedPrefix})`,
      };
    }
  }
  // Allow alphanum + common VAT chars after prefix normalization
  if (!/^[A-Z0-9]{5,}$/.test(vat)) {
    return { isValid: false, reason: 'VAT number contains invalid characters' };
  }
  return { isValid: true };
}

export type MandatoryVatTreatment = 'reverse_charge' | 'charge_vat' | 'zero_rated' | 'exempt';

export interface VatTreatment {
  /** The legally mandatory (or conservative default) treatment for the transaction. */
  mandatoryTreatment: MandatoryVatTreatment;
  /** VAT rate (0-1) that would apply if we charge. 0 for RC / zero-rated. */
  vatRate: number;
  /** Whether it is legally safe to offer the customer the "I wish to be billed VAT-inclusive" checkbox. */
  canOfferVatInclusive: boolean;
  /** Human-readable (and machine-loggable) explanation of how the treatment was reached. Stored in metadata for audit. */
  reason: string;
  /** Whether a VAT number was supplied and passed basic format/prefix validation. */
  isValidVatNumber: boolean;
  /** The raw customer country used for the decision (normalized). */
  customerCountry: string;
}

/**
 * THE CORE FUNCTION — VAT Treatment Determination (spec §2).
 * Must be called early (before offering any choice or computing billed amounts).
 *
 * Rules (documented for tax advisor + auditability):
 * - Supplier is always FR.
 * - Domestic FR: mandatory charge_vat at FR rate. Reverse charge does not apply domestically.
 *   canOffer=false (no meaningful "opt into inclusive" — supplier must charge).
 * - Intra-EU (different EU country):
 *     - Valid VAT# (format + correct prefix): mandatory reverse_charge (0 rate). canOffer=false (never allowed).
 *     - Missing or invalid VAT#: charge_vat (customer rate or conservative FR). canOffer=true (per "no valid VAT number").
 * - Non-EU / 'other' / unknown: zero_rated (export). canOffer=false (conservative).
 * - Legal precedence: if reverse charge is mandatory, choice is NEVER offered or accepted.
 */
export function determineVatTreatment(params: {
  customerCountry: string;
  vatNumber?: string;
  supplyType?: 'goods' | 'services'; // currently unused (uniform treatment for whole order)
}): VatTreatment {
  const rawCountry = (params.customerCountry || 'other').toUpperCase();
  const customerCountry = (EU_COUNTRIES as readonly string[]).includes(rawCountry) ? rawCountry : 'other';
  const vatInput = params.vatNumber;
  const { isValid: isValidVatNumber } = validateVatNumber(vatInput, customerCountry);

  let mandatoryTreatment: MandatoryVatTreatment = 'zero_rated';
  let vatRate = 0;
  let canOfferVatInclusive = false;
  let reason = `Defaulted to zero_rated for unknown country=${customerCountry}`;

  const isDomestic = customerCountry === SUPPLIER_COUNTRY;
  const isIntraEu = isEuCountry(customerCountry) && customerCountry !== SUPPLIER_COUNTRY;

  if (isDomestic) {
    mandatoryTreatment = 'charge_vat';
    vatRate = VAT_RATES.FR ?? 0.20;
    canOfferVatInclusive = true; // Explicit customer election to inclusive billing is allowed (gross on choice); default remains net for compat until tax rules force.
    reason = `Domestic FR transaction (customerCountry=${customerCountry}). charge_vat rate available at ${vatRate * 100}%. Reverse charge does not apply. Choice offerable for explicit inclusive election.`;
  } else if (isIntraEu) {
    if (isValidVatNumber) {
      mandatoryTreatment = 'reverse_charge';
      vatRate = 0;
      canOfferVatInclusive = false;
      reason = `Intra-EU B2B with valid VAT number (prefix-matched). Mandatory reverse_charge (0%). Customer must account for VAT. Choice not offered.`;
    } else {
      mandatoryTreatment = 'charge_vat';
      vatRate = getVatRate(customerCountry) || VAT_RATES.FR || 0.20;
      canOfferVatInclusive = true;
      reason = `Intra-EU but no valid VAT number (isValid=${isValidVatNumber}). Reverse charge not available. charge_vat at ${vatRate * 100}%. Choice may be offered.`;
    }
  } else {
    // Non-EU, 'other', or unknown
    mandatoryTreatment = 'zero_rated';
    vatRate = 0;
    canOfferVatInclusive = false;
    reason = `Non-EU / export / 'other' country (${customerCountry}). zero_rated (no VAT charged by supplier; possible import VAT for customer). Choice not offered.`;
  }

  // Extra conservatism: if for any reason we ended up with canOffer but rate==0 and not a "choice to pay tax" scenario, force false.
  if (vatRate <= 0) {
    canOfferVatInclusive = false;
  }

  const result: VatTreatment = {
    mandatoryTreatment,
    vatRate,
    canOfferVatInclusive,
    reason,
    isValidVatNumber,
    customerCountry,
  };

  if (DEBUG_VAT) {
    console.log('[VAT DEBUG] determineVatTreatment', {
      input: params,
      result,
    });
  }

  return result;
}

/**
 * Money-safe gross-up helper (client + server identical).
 * Input netTotal is in EUR (e.g. 7990). Returns gross / vat in EUR (float with 2 decimals semantics).
 * All Stripe amounts are later *100 to cents; we keep the rounding here consistent.
 *
 * When !isVatInclusive or rate==0: returns net unchanged, vatAmount=0.
 */
export function computeVatAmounts(
  netTotal: number,
  vatRate: number,
  isVatInclusive: boolean,
): { net: number; vatAmount: number; gross: number; rateUsed: number } {
  if (!isVatInclusive || vatRate <= 0 || netTotal <= 0) {
    return { net: netTotal, vatAmount: 0, gross: netTotal, rateUsed: 0 };
  }
  // Work in cents for rounding safety
  const netCents = Math.round(netTotal * 100);
  const vatCents = Math.round(netCents * vatRate);
  const grossCents = netCents + vatCents;

  const rateUsed = vatRate;
  return {
    net: netTotal,
    vatAmount: vatCents / 100,
    gross: grossCents / 100,
    rateUsed,
  };
}

/**
 * Convenience: given a treatment + explicit customer choice (only use after server validation),
 * returns whether we will actually charge VAT on this transaction and the effective rate.
 */
export function resolveFinalVatCharge(
  treatment: VatTreatment,
  customerWantsInclusive: boolean,
): { chargesVat: boolean; effectiveRate: number; reason: string } {
  if (customerWantsInclusive && !treatment.canOfferVatInclusive) {
    // Caller must have already rejected; this is defensive
    return {
      chargesVat: treatment.mandatoryTreatment === 'charge_vat',
      effectiveRate: treatment.mandatoryTreatment === 'charge_vat' ? treatment.vatRate : 0,
      reason: 'Customer choice ignored (illegal under mandatory treatment): ' + treatment.reason,
    };
  }
  const isRc = treatment.mandatoryTreatment === 'reverse_charge';
  const chargesVat = !isRc && (customerWantsInclusive || treatment.mandatoryTreatment === 'charge_vat');
  const effectiveRate = chargesVat ? treatment.vatRate : 0;
  return {
    chargesVat,
    effectiveRate,
    reason: treatment.reason + (customerWantsInclusive ? ' (customer elected inclusive)' : ''),
  };
}
