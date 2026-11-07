-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attachmentMime" TEXT,
ADD COLUMN     "attachmentName" TEXT,
ADD COLUMN     "attachmentSize" INTEGER;
