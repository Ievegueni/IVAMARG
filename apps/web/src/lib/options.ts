import { useApi } from './useApi';

export type Stage = { id: string; name: string; order: number; isWon: boolean; isLost: boolean; active: boolean; businessLineId: string };
export type BusinessLine = { id: string; name: string; kind: 'CONSTRUCTION' | 'UNIFORMS' | 'CLEANING' | 'BOREHOLE'; active: boolean; order: number; pipelineStages: Stage[] };

export const useBusinessLines = () => useApi<BusinessLine[]>('/backoffice/business-lines');
export const useUserOptions = () => useApi<{ id: string; name: string }[]>('/users/options');
export const useAppSettings = () => useApi<{ proposalValidityDays: number; approvalThreshold: number; orderSizes: string[] }>('/backoffice/app-settings');
export type Warehouse = { id: string; code: string; name: string; active: boolean };
export const useWarehouses = () => useApi<Warehouse[]>('/stock/warehouses');
export type PStage = { id: string; name: string; order: number; type: 'INTERNAL' | 'EXTERNAL' | 'QUALITY'; sectionId: string | null; active: boolean };
export const useStages = () => useApi<PStage[]>('/production/config/stages');
