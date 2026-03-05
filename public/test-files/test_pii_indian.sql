-- Indian Customer Data Export — PII Sanitization Test File
-- Contains: Names, Aadhaar, PAN, Phone, Email, UPI, Address, Credit Card

CREATE TABLE customers (
    id          INT PRIMARY KEY,
    full_name   VARCHAR(100),
    aadhaar     VARCHAR(14),
    pan         VARCHAR(10),
    phone       VARCHAR(15),
    email       VARCHAR(100),
    dob         DATE,
    address     TEXT,
    upi_id      VARCHAR(50),
    credit_card VARCHAR(20),
    ifsc        VARCHAR(11),
    account_no  VARCHAR(18)
);

INSERT INTO customers VALUES (
    1,
    'Rahul Sharma',
    '5487 8795 5678',
    'ABCPS1234D',
    '9876543210',
    'rahul.sharma@gmail.com',
    '1990-03-15',
    '42, MG Road, Bangalore, Karnataka 560001',
    'rahul.sharma@okicici',
    '4111 1111 1111 1111',
    'ICIC0001234',
    '123456789012'
);

INSERT INTO customers VALUES (
    2,
    'Priya Mehta',
    '2345 6789 0123',
    'DGHPM5678K',
    '8765432109',
    'priya.mehta@yahoo.co.in',
    '1985-07-22',
    'Flat 3B, Sunshine Apartments, Andheri West, Mumbai 400053',
    'priya.mehta@paytm',
    '5500 0000 0000 0004',
    'HDFC0002345',
    '987654321098'
);

INSERT INTO customers VALUES (
    3,
    'Arjun Verma',
    '9876 5432 1098',
    'FGHAV9012L',
    '7654321098',
    'arjun.verma@company.in',
    '1995-11-30',
    'House No 7, Civil Lines, New Delhi 110001',
    'arjun@upi',
    '3714 496353 98431',
    'SBIN0003456',
    '246810121416'
);

-- Staff table
CREATE TABLE staff (
    employee_id INT,
    name        VARCHAR(100),
    passport_no VARCHAR(12),
    mobile      VARCHAR(15),
    work_email  VARCHAR(100)
);

INSERT INTO staff VALUES (101, 'Deepa Krishnan', 'N1234567', '9988776655', 'deepa.k@corp.com');
INSERT INTO staff VALUES (102, 'Mohammed Irfan', 'P9876543', '9876012345', 'irfan.m@corp.com');
INSERT INTO staff VALUES (103, 'Sunita Rajan',   'Z5678901', '8800991122', 'sunita.r@corp.com');
