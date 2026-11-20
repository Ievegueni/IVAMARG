import { useState } from 'react';
import { ImportWizard } from '../../components/ImportWizard';
import { Field, Select } from '../../components/ui';
import { useWarehouses } from '../../lib/options';

/** Migração: artigos de stock com quantidade e custo iniciais. */
export function ImportItemsPage() {
  const whs = useWarehouses();
  const [wh, setWh] = useState('');
  const warehouseId = wh || whs.data?.[0]?.id;
  return (
    <ImportWizard
      title="Importar artigos e stock inicial"
      endpoint="/stock/items/import"
      back="/stock"
      extraBody={{ warehouseId }}
      help={<p>Colunas: <b>Código</b> e <b>Nome</b> (obrigatórias), <b>Unidade</b> (m, kg, un…), Categoria (matéria-prima / material de obra / consumível), Stock mínimo, <b>Quantidade</b> e <b>Custo unitário</b> (Kz) do stock inicial. A quantidade entra no armazém escolhido e define o custo médio.</p>}
    >
      <Field label="Armazém do stock inicial">
        <Select className="max-w-xs" value={warehouseId} onChange={(e) => setWh(e.target.value)}>{whs.data?.filter((w) => w.active).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
      </Field>
    </ImportWizard>
  );
}
