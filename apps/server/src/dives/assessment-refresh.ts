import type { FastifyInstance } from 'fastify';
import type { AssessmentService } from '../assessment/assessment-service.js';

/** What a route plugin that changes Dives needs of the assessment; providers/ takes it from here, not from assessment/. */
export type AssessmentRefresh = Pick<AssessmentService, 'refreshUser'>;

/**
 * Whatever changed a Dive may change its findings and those of the dives around it (ADR 0036): after a successful
 * change by a User, theirs are brought up to date before the answer goes out, so the client's next read sees them.
 * A failure here never fails the change itself.
 */
export function refreshAssessmentsAfterChange(app: FastifyInstance, assessments: AssessmentRefresh): void {
  app.addHook('onSend', async (request, reply) => {
    if (request.method === 'GET' || reply.statusCode >= 300 || !request.user) return;
    await assessments.refreshUser(request.user.id).catch((error) => request.log.error({ err: error }, 'dive assessment failed'));
  });
}
