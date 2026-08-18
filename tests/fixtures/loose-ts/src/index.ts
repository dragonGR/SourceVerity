function getUser(id) {
  const users = [{ id: "1", name: "Alice" }];
  const user = users.find((u) => u.id === id);
  return user.name;
}

getUser("1");
