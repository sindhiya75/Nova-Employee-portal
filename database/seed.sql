INSERT INTO "Users" ("Name", "Email", "Role") VALUES
('Admin User', 'admin@localhost.test', 'Admin'),
('Project Manager', 'manager@localhost.test', 'Manager');

INSERT INTO "Clients" ("ClientName", "ContactPerson", "Email", "Phone", "Address") VALUES
('National Green Bridges Infra', 'R. Menon', 'client@ngbi.test', '+91 90000 10001', 'Chennai, Tamil Nadu'),
('Metro Corridor Authority', 'S. Rao', 'metro@authority.test', '+91 90000 10002', 'Bengaluru, Karnataka');

INSERT INTO "Employees" ("EmployeeName", "Email", "Phone", "Designation", "Department") VALUES
('Aarav Kumar', 'aarav@localhost.test', '+91 90000 20001', 'Site Engineer', 'Execution'),
('Meera Nair', 'meera@localhost.test', '+91 90000 20002', 'QA Engineer', 'Quality'),
('Vikram Singh', 'vikram@localhost.test', '+91 90000 20003', 'Planning Engineer', 'Planning');

INSERT INTO "Projects" ("ProjectName", "ClientId", "Package", "Location", "StartDate", "EndDate", "Description") VALUES
('Canal Aqueduct Package A', 1, 'NGBI-AQ-01', 'Coimbatore', '2026-04-01', '2027-03-31', 'Aqueduct works with pile foundation, piers, and deck slab.'),
('Elevated Metro Viaduct', 2, 'MCA-EV-04', 'Bengaluru', '2026-05-15', '2027-08-30', 'Metro viaduct civil package.');

INSERT INTO "SubWorks" ("ProjectId", "ParentSubWorkId", "SubWorkName", "Description") VALUES
(1, NULL, 'Aqueduct', 'Main aqueduct scope'),
(1, 1, 'Pile Foundation', 'Bored cast in-situ piles'),
(1, 1, 'Pier', 'Pier stem and pier cap'),
(1, 1, 'Deck Slab', 'Reinforced deck slab'),
(2, NULL, 'Viaduct', 'Main viaduct scope'),
(2, 5, 'Pier Cap', 'Pre-stressed pier caps');

INSERT INTO "Tasks" ("TaskName", "Description", "ProjectId", "SubWorkId", "AssignedEmployeeId", "Priority", "StartDate", "FinishDate", "PlannedQuantity", "Unit", "Remarks", "Status", "ProgressPercent") VALUES
('Pile boring at A1', 'Complete pile boring and cage lowering for abutment A1.', 1, 2, 1, 'High', '2026-07-01', '2026-07-15', 12, 'Nos', 'Night shift allowed.', 'Running', 45),
('Pier reinforcement inspection', 'Check rebar spacing and cover blocks before shuttering.', 1, 3, 2, 'Medium', '2026-07-05', '2026-07-10', 1, 'Lot', 'QA hold point.', 'Open', 0),
('Deck slab concrete pour', 'M35 concrete pour for deck slab segment DS-01.', 1, 4, 1, 'Critical', '2026-07-18', '2026-07-19', 180, 'Cum', 'Pump and transit mixer confirmed.', 'Open', 0),
('Pier cap stressing', 'Stressing activity for pier cap PC-04.', 2, 6, 3, 'High', '2026-07-08', '2026-07-11', 8, 'Tendons', 'Coordinate with specialist agency.', 'Closed', 100);

INSERT INTO "TaskProgress" ("TaskId", "EmployeeId", "WorkDate", "TodayQuantity", "TodayProgressPercent", "Remarks") VALUES
(1, 1, '2026-07-08', 5, 25, 'Boring completed for five piles.'),
(1, 1, '2026-07-09', 4, 20, 'Cage lowering in progress.'),
(4, 3, '2026-07-09', 8, 100, 'Stressing completed and records submitted.');
