-- CreateIndex
CREATE INDEX "Event_id_unique_id_idx" ON "Event"("id", "unique_id");

-- CreateIndex
CREATE INDEX "Outcome_id_outcome_title_idx" ON "Outcome"("id", "outcome_title");

-- CreateIndex
CREATE INDEX "TokenAllocation_id_userId_outcomeId_idx" ON "TokenAllocation"("id", "userId", "outcomeId");

-- CreateIndex
CREATE INDEX "Trade_id_eventID_outcomeId_userID_idx" ON "Trade"("id", "eventID", "outcomeId", "userID");

-- CreateIndex
CREATE INDEX "User_id_wallet_address_idx" ON "User"("id", "wallet_address");
