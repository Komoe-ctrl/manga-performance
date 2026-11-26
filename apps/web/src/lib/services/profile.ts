import { toPublicProfile, type PublicProfile } from "@/lib/content/public-profile";
import * as actions from "@/server/actions/site-profile";
import { USE_DB, unwrap } from "./data-source";
import { db, latency } from "./store";

/** Contenu public édité dans l'admin (chiffres clés, informations légales, cas client et FAQ des services). */
export const getPublicProfile = (): Promise<PublicProfile> =>
  USE_DB ? unwrap(actions.getPublicProfileAction()) : latency(() => toPublicProfile(db.settings));
