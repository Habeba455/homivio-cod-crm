/**
 * Moroccan phone normalisation to E.164 (architecture §8.5).
 * Validates format only. It does not check that a number is live.
 */

export type PhoneResult = { ok: true; e164: string } | { ok: false; problem: string };

const MAX_INPUT_LENGTH = 40;
const MOROCCAN_E164 = /^\+212[5-7]\d{8}$/;

export function normalizeMoroccanPhone(input: string): PhoneResult {
  if (input.length > MAX_INPUT_LENGTH) {
    return fail("is too long");
  }

  const compact = input.replace(/[\s.()-]/g, "");
  if (!/^\+?\d+$/.test(compact)) {
    return fail("contains characters other than digits, spaces, dots, dashes or parentheses");
  }

  let candidate: string;
  if (compact.startsWith("+212")) {
    candidate = compact;
  } else if (compact.startsWith("+")) {
    return fail("is not a Moroccan number");
  } else if (compact.startsWith("00212")) {
    candidate = `+${compact.slice(2)}`;
  } else if (/^0\d{9}$/.test(compact)) {
    candidate = `+212${compact.slice(1)}`;
  } else if (/^212\d{9}$/.test(compact)) {
    candidate = `+${compact}`;
  } else {
    return fail("must start with +212, 00212, or 0 followed by nine digits");
  }

  if (!/^\+212\d{9}$/.test(candidate)) {
    return fail("must have nine digits after +212");
  }
  if (!MOROCCAN_E164.test(candidate)) {
    return fail("national number must start with 5, 6 or 7");
  }
  return { ok: true, e164: candidate };
}

function fail(problem: string): PhoneResult {
  return { ok: false, problem };
}
