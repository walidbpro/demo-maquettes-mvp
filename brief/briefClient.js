// Version maquette : le parcours est complet, mais aucun besoin n'est envoyé
// vers un système externe depuis cette démonstration publique.

export async function extraireBrief() {
  return { ok: true, extraction: null, source: "regles" };
}

export async function submitBrief() {
  await new Promise((resolve) => setTimeout(resolve, 650));
  return {
    ok: true,
    leadId: `DEMO-${Date.now().toString(36).toUpperCase()}`,
    mocked: true,
  };
}
