/**
 * Job diario: snapshot do catalogo do Bazaar.
 * Uso: npm run snapshot
 */
import { runSnapshot } from "../bazaar/snapshot.js";

const started = Date.now();
runSnapshot()
  .then(({ itemsSeen, listingsUpserted }) => {
    console.log(
      `OK em ${Math.round((Date.now() - started) / 1000)}s - ${itemsSeen} itens, ${listingsUpserted} listagens.`,
    );
  })
  .catch((err) => {
    console.error("Snapshot falhou:", err);
    process.exit(1);
  });
