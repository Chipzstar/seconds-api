const express = require("express");
const { newDelivery } = require("../helpers/stuart");
const router = express.Router();

router.post("/new-delivery", newDelivery)

module.exports = router;

