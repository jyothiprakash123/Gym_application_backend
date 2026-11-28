const express = require("express");
const { getCountries, getStates } = require("../controllers/locationController");

const router = express.Router();

router.get("/countries", getCountries);
router.get("/states", getStates);

module.exports = router;
