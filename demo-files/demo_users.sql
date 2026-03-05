-- Demo users table with PII (for testing PII detection)
CREATE TABLE IF NOT EXISTS users (
    id           INT PRIMARY KEY,
    first_name   VARCHAR(50),
    last_name    VARCHAR(50),
    email        VARCHAR(100),
    phone        VARCHAR(20),
    aadhaar      VARCHAR(14),
    pan          VARCHAR(10),
    card_number  VARCHAR(22),
    cvv          VARCHAR(3),
    expiry       VARCHAR(5)
);

INSERT INTO users (id, first_name, last_name, email, phone, aadhaar, pan, card_number, cvv, expiry) VALUES
  (1, 'Isaac', 'Bakshi', 'liamchaudry@example.net', '+91 70433 21819', '8001 3389 0838', 'KLHPY2654E', '4351 1615 5940 7816', '180', '09/28'),
  (2, 'Gagan', 'Sami', 'kamdarviraj@example.net', '+91 94192 83276', '6835 0305 6413', 'XOSAU7672I', '4238 8496 9653 2871', '873', '01/26'),
  (3, 'Avi', 'Issac', 'saumyamall@example.org', '+91 82704 82814', '5252 8809 5701', 'YWVBH0391C', '4718 2278 2489 6383', '830', '05/29'),
  (4, 'Nathaniel', 'Sami', 'tanveernayar@example.org', '+91 70518 34738', '4997 3763 1165', 'LMSEU1065Z', '4133 3872 6247 3178', '200', '01/30'),
  (5, 'Lajita', 'Chatterjee', 'caleb78@example.org', '+91 83098 05009', '9882 0812 1913', 'KYOTT0916V', '4998 5435 3462 4751', '109', '08/30');
