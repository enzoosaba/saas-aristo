import Card from "@/components/ui/Card";

export default function Loading() {
  return <section className="loading-view" aria-busy="true" aria-label="Carregando conteúdo">
    <p role="status">Carregando seu espaço de estudos…</p>
    <div className="loading-grid" aria-hidden="true">
      {[0, 1, 2, 3].map(item => <Card key={item} className="loading-card">
        <span className="skeleton-line" /><span className="skeleton-line skeleton-value" />
      </Card>)}
    </div>
  </section>;
}
