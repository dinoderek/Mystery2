import { supabase, supabaseUrl } from './supabase';
import { isImageLinkExpired } from '$lib/domain/store.retry';

export type ImagePurpose = 'blueprint_cover' | 'location_scene' | 'character_portrait';

export interface ResolveImageLinkRequest {
  blueprintId: string;
  imageId: string | null | undefined;
  purpose: ImagePurpose;
}

interface ImageLinkResponse {
  image_id: string;
  signed_url: string;
  expires_at: string;
}

interface CachedLink {
  imageId: string;
  signedUrl: string;
  expiresAt: string;
}

const cache = new Map<string, CachedLink>();

function cacheKey(request: ResolveImageLinkRequest): string {
  return `${request.blueprintId}:${request.purpose}:${request.imageId ?? ''}`;
}

function asImageLinkResponse(data: unknown): ImageLinkResponse | null {
  if (!data || typeof data !== 'object') return null;
  const typed = data as Record<string, unknown>;

  if (
    typeof typed.image_id !== 'string' ||
    typeof typed.signed_url !== 'string' ||
    typeof typed.expires_at !== 'string'
  ) {
    return null;
  }

  return {
    image_id: typed.image_id,
    signed_url: typed.signed_url,
    expires_at: typed.expires_at,
  };
}

export function clearImageLinkCache() {
  cache.clear();
}

export async function resolveImageLink(
  request: ResolveImageLinkRequest,
): Promise<{ url: string | null; expiresAt: string | null; placeholder: boolean }> {
  if (!request.imageId) {
    return { url: null, expiresAt: null, placeholder: false };
  }

  const key = cacheKey(request);
  const cached = cache.get(key);
  if (cached && !isImageLinkExpired(cached.expiresAt)) {
    return {
      url: cached.signedUrl,
      expiresAt: cached.expiresAt,
      placeholder: false,
    };
  }

  const { data, error } = await supabase.functions.invoke('blueprint-image-link', {
    body: {
      blueprint_id: request.blueprintId,
      image_id: request.imageId,
      purpose: request.purpose,
    },
  });

  if (error) {
    return { url: null, expiresAt: null, placeholder: true };
  }

  const parsed = asImageLinkResponse(data);
  if (!parsed || parsed.image_id !== request.imageId) {
    return { url: null, expiresAt: null, placeholder: true };
  }

  // The edge function returns a relative path to avoid internal Docker
  // hostnames leaking into the URL. Prepend the public Supabase base URL.
  const fullUrl = parsed.signed_url.startsWith('/')
    ? `${supabaseUrl}${parsed.signed_url}`
    : parsed.signed_url;

  cache.set(key, {
    imageId: parsed.image_id,
    signedUrl: fullUrl,
    expiresAt: parsed.expires_at,
  });

  return {
    url: fullUrl,
    expiresAt: parsed.expires_at,
    placeholder: false,
  };
}
