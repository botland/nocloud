/**
 * lib/vies.ts
 *
 * Server-side VAT number validation via the EU VIES (VAT Information Exchange System).
 * Used authoritatively in /api/checkout before reverse-charge treatment is applied.
 *
 * The official VIES checkVat SOAP service is called directly (no third-party dependency).
 * Client preview uses format-only checks in lib/vat.ts; VIES is server-only.
 */

import { validateVatNumber, isEuCountry } from './vat';

const VIES_ENDPOINT =
  'https://ec.europa.eu/taxation_customs/vies/services/checkVatService';

/** Greece is GR in our UI but EL in VIES. */
const VIES_COUNTRY_OVERRIDES: Record<string, string> = {
  GR: 'EL',
};

export interface ViesValidationResult {
  isValid: boolean;
  reason?: string;
  /** True when VIES could not be reached or returned a service error (not "invalid number"). */
  unavailable?: boolean;
  /** Registered name returned by VIES when valid (audit / display). */
  name?: string;
  /** Registered address returned by VIES when valid (audit / display). */
  address?: string;
}

export function parseVatForVies(vatNumber: string): { countryCode: string; vatNumber: string } {
  const normalized = vatNumber.trim().toUpperCase().replace(/[\s.-]/g, '');
  const prefix = normalized.slice(0, 2);
  const number = normalized.slice(2);
  const countryCode = VIES_COUNTRY_OVERRIDES[prefix] || prefix;
  return { countryCode, vatNumber: number };
}

function buildViesSoapRequest(countryCode: string, vatNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:checkVat>
      <urn:countryCode>${countryCode}</urn:countryCode>
      <urn:vatNumber>${vatNumber}</urn:vatNumber>
    </urn:checkVat>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`, 'i');
  const match = xml.match(re);
  return match?.[1]?.trim();
}

function isViesServiceFault(xml: string): boolean {
  return /faultstring|Fault|MS_UNAVAILABLE|SERVICE_UNAVAILABLE|TIMEOUT|GLOBAL_MAX_CONCURRENT_REQ/i.test(xml);
}

/**
 * Validates a VAT number against the EU VIES registry.
 * Requires a well-formed EU VAT number (format + country prefix).
 * Non-EU / empty numbers return isValid=false without calling VIES.
 */
export async function validateVatWithVies(
  vatNumber: string | undefined,
  customerCountry: string | undefined,
  options?: { timeoutMs?: number },
): Promise<ViesValidationResult> {
  const timeoutMs = options?.timeoutMs ?? 12_000;

  if (!vatNumber?.trim()) {
    return { isValid: false, reason: 'No VAT number provided' };
  }

  const formatCheck = validateVatNumber(vatNumber, customerCountry);
  if (!formatCheck.isValid) {
    return { isValid: false, reason: formatCheck.reason || 'Invalid VAT number format' };
  }

  const { countryCode, vatNumber: viesNumber } = parseVatForVies(vatNumber);

  if (!isEuCountry(countryCode) && countryCode !== 'EL') {
    return {
      isValid: false,
      reason: `VIES validation is only available for EU VAT numbers (got prefix ${countryCode})`,
    };
  }

  const soapBody = buildViesSoapRequest(countryCode, viesNumber);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(VIES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '',
      },
      body: soapBody,
      signal: controller.signal,
    });

    const xml = await response.text();

    if (!response.ok || isViesServiceFault(xml)) {
      const fault = extractXmlTag(xml, 'faultstring');
      return {
        isValid: false,
        unavailable: true,
        reason: fault || 'VIES service is temporarily unavailable',
      };
    }

    const validStr = extractXmlTag(xml, 'valid');
    const isValid = validStr?.toLowerCase() === 'true';

    if (!isValid) {
      return {
        isValid: false,
        reason: 'VAT number is not registered or not valid according to VIES',
      };
    }

    return {
      isValid: true,
      name: extractXmlTag(xml, 'name'),
      address: extractXmlTag(xml, 'address'),
      reason: 'VAT number verified via VIES',
    };
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      isValid: false,
      unavailable: true,
      reason: isAbort
        ? 'VIES verification timed out — please try again'
        : 'Could not reach VIES verification service',
    };
  } finally {
    clearTimeout(timer);
  }
}