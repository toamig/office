export default {
  kind: "source",
  create() {
    return {
      id: "sample-source",
      async items() {
        return [{ kind: "note", label: "From the sample source", link: { view: "home" } }];
      },
    };
  },
};
