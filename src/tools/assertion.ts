import { z } from 'zod';

export const rtlGenerateAssertionSchema = z.object({
  signal: z.string().describe('Signal the property reasons about (e.g. count, valid)'),
  clock: z.string().optional().default('clk').describe('Clock signal name (default: clk)'),
  reset: z.string().optional().describe('Reset signal name (e.g. rst_n); omit for reset-free properties'),
  reset_active_low: z
    .boolean()
    .optional()
    .default(true)
    .describe('Whether reset is active-low (default: true)'),
  property_type: z
    .enum(['no_x_after_reset', 'reset_value', 'req_ack_handshake', 'onehot'])
    .describe(
      'Property template: no_x_after_reset | reset_value | req_ack_handshake | onehot'
    ),
  ack_signal: z
    .string()
    .optional()
    .describe('Acknowledge signal (required for req_ack_handshake; signal acts as req)'),
  reset_value: z
    .string()
    .optional()
    .default('0')
    .describe("Expected value right after reset (for reset_value; default: '0')"),
});

export interface AssertionResult {
  success: boolean;
  propertyType: string;
  sva: string;
  explanation: string;
  nextSteps: string[];
  errors: string[];
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function disableIff(reset?: string, activeLow?: boolean): string {
  if (!reset) return '';
  return activeLow ? `disable iff (!${reset}) ` : `disable iff (${reset}) `;
}

export function buildAssertion(
  args: z.infer<typeof rtlGenerateAssertionSchema>
): AssertionResult {
  const { signal, clock, reset, reset_active_low, property_type, ack_signal, reset_value } = args;

  if (!IDENT_RE.test(signal)) {
    return fail(property_type, [`Invalid signal name: "${signal}".`]);
  }
  if (!IDENT_RE.test(clock)) {
    return fail(property_type, [`Invalid clock name: "${clock}".`]);
  }
  if (reset !== undefined && !IDENT_RE.test(reset)) {
    return fail(property_type, [`Invalid reset name: "${reset}".`]);
  }
  if (property_type === 'req_ack_handshake') {
    if (!ack_signal || !IDENT_RE.test(ack_signal)) {
      return fail(property_type, [
        'req_ack_handshake requires ack_signal (valid identifier).',
      ]);
    }
  }
  if (
    (property_type === 'no_x_after_reset' || property_type === 'reset_value') &&
    !reset
  ) {
    return fail(property_type, [
      `${property_type} requires reset (unknown which reset releases the design otherwise).`,
    ]);
  }

  const dis = disableIff(reset, reset_active_low);
  let sva: string;
  let explanation: string;

  switch (property_type) {
    case 'no_x_after_reset':
      sva = `assert property (@(posedge ${clock}) ${dis}!$isunknown(${signal}));`;
      explanation = `Every cycle out of reset, ${signal} must be fully driven (no X). Catches missing-reset and undriven-net bugs.`;
      break;
    case 'reset_value': {
      const edge = reset_active_low ? `$fell(${reset})` : `$rose(${reset})`;
      sva = `assert property (@(posedge ${clock}) ${edge} |-> ##1 ${signal} == ${reset_value});`;
      explanation = `One cycle after reset asserts, ${signal} must equal ${reset_value}. Encodes the reset contract for formal or simulation checkers.`;
      break;
    }
    case 'req_ack_handshake':
      sva = `assert property (@(posedge ${clock}) ${dis}${signal} |-> ##[1:$] ${ack_signal});`;
      explanation = `Every ${signal} (req) must eventually be followed by ${ack_signal} (ack). Liveness-style handshake obligation; bound the ##[1:$] delay for formal tractability.`;
      break;
    case 'onehot':
      sva = `assert property (@(posedge ${clock}) ${dis}$onehot(${signal}));`;
      explanation = `${signal} must have exactly one bit set whenever checked. Encodes one-hot FSM/arbiter intent.`;
      break;
  }

  return {
    success: true,
    propertyType: property_type,
    sva: `${sva}\n// TODO: bind with correct clock/reset, then prove with SymbiYosys (mcp-formal) or simulate with SVA support.`,
    explanation,
    nextSteps: [
      'Review the TODO: confirm polarity, width, and reset value match the spec.',
      'Prove with a formal engine or run in simulation before signoff.',
    ],
    errors: [],
  };
}

function fail(propertyType: string, errors: string[]): AssertionResult {
  return {
    success: false,
    propertyType,
    sva: '',
    explanation: '',
    nextSteps: [],
    errors,
  };
}
