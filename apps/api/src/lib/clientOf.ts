import { prisma } from './prisma';

/** Cliente associado a uma entidade (para pôr eventos na timeline do cliente). */
export async function clientIdOf(entity: string, entityId: string): Promise<string | null> {
  const pick = async (p: Promise<{ clientId: string } | null>) => (await p)?.clientId ?? null;
  switch (entity) {
    case 'Client': return (await prisma.client.findUnique({ where: { id: entityId }, select: { id: true } }))?.id ?? null;
    case 'Opportunity': return pick(prisma.opportunity.findUnique({ where: { id: entityId }, select: { clientId: true } }));
    case 'Proposal': return pick(prisma.proposal.findUnique({ where: { id: entityId }, select: { clientId: true } }));
    case 'Contract': return pick(prisma.contract.findUnique({ where: { id: entityId }, select: { clientId: true } }));
    case 'Order': return pick(prisma.order.findUnique({ where: { id: entityId }, select: { clientId: true } }));
    case 'Project': return pick(prisma.project.findUnique({ where: { id: entityId }, select: { clientId: true } }));
    case 'Borehole': return pick(prisma.borehole.findUnique({ where: { id: entityId }, select: { clientId: true } }));
    case 'ProductionOrder':
      return (await prisma.productionOrder.findUnique({ where: { id: entityId }, select: { order: { select: { clientId: true } } } }))?.order.clientId ?? null;
    default: return null;
  }
}
