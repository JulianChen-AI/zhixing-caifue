import { z } from 'zod';
const proposal=z.object({quote:z.string().min(1).max(2000),functionId:z.string().regex(/^(TR|BI|SU|IN|CA)\d{2}$/),params:z.record(z.string(),z.unknown()).optional()}).strict();
const shape={operation:z.enum(['create','interrupt','amend','status','resume','pause','cancel','open_saved']),planId:z.string().uuid().optional(),stepId:z.string().uuid().optional(),taskId:z.string().uuid().optional(),functionId:z.string().regex(/^(TR|BI|SU|IN|CA)\d{2}$/).optional(),params:z.record(z.string(),z.unknown()).optional(),steps:z.array(proposal).min(1).max(6).optional(),tasks:z.array(proposal).min(1).max(6).optional()};
export const planToolArguments=z.object(shape).strict();
export const planCardArguments=z.object({...shape,clarification:z.string().trim().min(1).max(2000).optional()}).strict();
export type PlanToolArguments=z.infer<typeof planToolArguments>;

