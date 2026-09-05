import { ToolRunner } from '../runner.js';
import { z } from 'zod';

export const rtlToolchainInfoSchema = z.object({
  cwd: z.string().optional().describe('Optional workspace directory'),
});

export async function handleRtlToolchainInfo(
  runner: ToolRunner,
  args: z.infer<typeof rtlToolchainInfoSchema>
) {
  const info = await runner.getToolchainInfo(args.cwd);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(info, null, 2),
      },
    ],
  };
}
