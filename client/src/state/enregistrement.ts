// Enregistrement au fil de la saisie (compte rendu d'entretien, dialogs/EntDialog.tsx) : chaque section part en
// quittant son champ, les envois sont faits l'un après l'autre, et une section n'est réputée enregistrée qu'après
// la réponse du serveur. Une section refusée reste à enregistrer : la clôture et la signature attendent qu'elle le
// soit. « Fermer sans enregistrer » (`abandonner`) arrête tout envoi, y compris le dernier, au démontage du dialogue.

/** Réponse d'un envoi : enregistré, ou refusé avec son motif. */
export interface ReponseEnvoi { ok: boolean; error?: string }

export class EnregistrementAuFil {
  /** Valeur enregistrée par le serveur, et dernière valeur envoyée, par section. */
  private enregistre: Record<string, string>;
  private envoye: Record<string, string>;
  private file: Promise<unknown> = Promise.resolve();
  private abandon = false;
  private envoyer: (section: string, valeur: string) => Promise<ReponseEnvoi>;
  private suivre: (section: string, refus: string | null) => void;

  /**
   * `envoyer` : envoi d'une section au serveur ; `suivre` : état d'une section après la réponse (motif du refus,
   * ou null une fois enregistrée).
   */
  constructor(
    initial: Record<string, string>,
    envoyer: (section: string, valeur: string) => Promise<ReponseEnvoi>,
    suivre: (section: string, refus: string | null) => void,
  ) {
    this.enregistre = { ...initial };
    this.envoye = { ...initial };
    this.envoyer = envoyer;
    this.suivre = suivre;
  }

  /** Envoie la section si elle a changé depuis le dernier envoi (rien après `abandonner`) ; attend les envois en cours. */
  enregistrer(section: string, valeur: string): Promise<unknown> {
    if (this.abandon || (this.envoye[section] ?? '') === valeur) return this.file;
    this.envoye[section] = valeur;
    this.file = this.file.then(async () => {
      const r = await this.envoyer(section, valeur);
      if (r.ok) {
        this.enregistre[section] = valeur;
        this.suivre(section, null);
      } else {
        // Refusée : la section reste à enregistrer, un nouvel envoi de la même valeur la renverra.
        if (this.envoye[section] === valeur) this.envoye[section] = this.enregistre[section] ?? '';
        this.suivre(section, r.error || 'non enregistrée');
      }
    });
    return this.file;
  }

  /** Enregistre les `sections` telles qu'affichées (`valeurs`) ; renvoie celles qui ne sont pas enregistrées. */
  async toutEnregistrer(sections: string[], valeurs: Record<string, string>): Promise<string[]> {
    sections.forEach(k => this.enregistrer(k, valeurs[k] ?? ''));
    await this.file;
    return sections.filter(k => (this.enregistre[k] ?? '') !== (valeurs[k] ?? ''));
  }

  /** « Fermer sans enregistrer » : plus aucun envoi, même au démontage du dialogue. */
  abandonner() { this.abandon = true; }
}
