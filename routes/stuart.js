const express = require("express");
const { newJob } = require("../helpers/stuart");
const router = express.Router();

router.post("/new-delivery", newJob)

module.exports = router;

