export type IndexedRepositoryDocument = {
  filename: string;
  id: string;
};

export function staleRepositoryDocumentIds(
  documents: IndexedRepositoryDocument[],
  activePaths: ReadonlySet<string>,
): string[] {
  return documents
    .filter((document) => !activePaths.has(document.filename))
    .map((document) => document.id);
}
