import { ImportWizard } from '../../components/ImportWizard';

export const ImportPage = () => (
  <ImportWizard
    title="Importar clientes"
    endpoint="/clients/import"
    back="/clientes"
    help={<p>Ficheiro Excel (.xlsx) ou CSV com cabeçalho na primeira linha. Colunas reconhecidas: <b>Nome</b> (obrigatória), NIF, Telefone (vários separados por ;), Email, Morada, Notas, Tags (separadas por vírgula).</p>}
  />
);
