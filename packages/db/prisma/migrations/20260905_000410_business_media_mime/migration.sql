-- MIME content-type for business logo/cover objects so the media-serving
-- endpoint can replay the correct content type (Prompt 09).
ALTER TABLE "business" ADD COLUMN "logo_mime" TEXT;
ALTER TABLE "business" ADD COLUMN "cover_mime" TEXT;