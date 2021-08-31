const express = require("express");
const {createJob, getJob, updateJob, deleteJob} = require("../helpers");
const router = express.Router();

router.post("/create", createJob)
router.get("/:job_id", getJob)
router.patch("/:job_id", updateJob)
router.delete("/:job_id", deleteJob)

module.exports = router;