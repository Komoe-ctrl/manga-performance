-- The composite index (submissionId, version) from the previous migration supersedes it.

-- DropIndex
DROP INDEX "HotelKpiResult_submissionId_idx";
