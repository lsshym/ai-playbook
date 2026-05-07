type FormState = {
  firstName: string;
  lastName: string;
};

type CreateProfileRequest = {
  full_name: string;
};

export function handleSubmit(form: FormState, submit: (request: CreateProfileRequest) => void) {
  submit({
    full_name: `${form.firstName} ${form.lastName}`,
  });
}
