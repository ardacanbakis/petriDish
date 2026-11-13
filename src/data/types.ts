/** Provenance metadata carried by every biological data entry. */
export interface Provenance {
  /** Where the values come from (papers, handbooks, standards). */
  sources: string[];
  /** How values were chosen or adapted; caveats for the reviewer. */
  notes: string;
  /** Set to true only after a domain expert has checked the entry. */
  reviewed: boolean;
}
