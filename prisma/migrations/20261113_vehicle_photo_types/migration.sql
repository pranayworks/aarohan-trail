-- Two more mandatory driver photos: the number plate (close up) and the whole vehicle. New enum values only.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'NUMBER_PLATE_PHOTO';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'VEHICLE_PHOTO';
